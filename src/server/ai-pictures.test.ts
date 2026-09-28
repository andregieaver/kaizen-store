import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { pictureFileName, shrinkPicture } = await import("./ai-pictures");

describe("pictures the AI makes (D92)", () => {
  it("are kept as the browser keeps uploads: WebP, at most 1600 pixels wide, and a 480-pixel copy", async () => {
    const png = await sharp({ create: { width: 2048, height: 1024, channels: 3, background: "#3a7" } }).png().toBuffer();
    const shrunk = await shrinkPicture(new Uint8Array(png));
    expect([shrunk.width, shrunk.height]).toEqual([1600, 800]);
    expect((await sharp(shrunk.image).metadata()).format).toBe("webp");
    expect((await sharp(shrunk.thumbnail).metadata()).width).toBe(480);
    // Never made larger than the model made it.
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect((await shrinkPicture(new Uint8Array(small))).width).toBe(300);
  });

  it("are named after what they show", () => {
    expect(pictureFileName("Lys butikk med grønne planter på hyller")).toBe("ai-lys-butikk-med-gronne-planter-pa-hyller.webp");
    expect(pictureFileName("")).toBe("ai-picture.webp");
  });
});
