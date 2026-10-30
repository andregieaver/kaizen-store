import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { aiSourceXmp, pictureFileName, shrinkPicture } = await import("./ai-pictures");

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

  it("say in each file that AI made or changed them, and a picture from elsewhere says nothing (AI Act Art. 50(2))", async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3a7" } }).png().toBuffer();
    const made = await shrinkPicture(new Uint8Array(png), "made");
    for (const file of [made.image, made.thumbnail]) {
      const xmp = (await sharp(file).metadata()).xmp?.toString("utf8") ?? "";
      expect(xmp).toContain("Iptc4xmpExt:DigitalSourceType");
      expect(xmp).toContain("digitalsourcetype/trainedAlgorithmicMedia");
    }
    const edited = await shrinkPicture(new Uint8Array(png), "edited");
    expect((await sharp(edited.image).metadata()).xmp?.toString("utf8")).toContain("compositeWithTrainedAlgorithmicMedia");
    const copied = await shrinkPicture(new Uint8Array(png));
    expect((await sharp(copied.image).metadata()).xmp).toBeUndefined();
    expect(aiSourceXmp("made")).toMatch(/^<x:xmpmeta[\s\S]*<\/x:xmpmeta>$/);
  });

  it("are named after what they show", () => {
    expect(pictureFileName("Lys butikk med grønne planter på hyller")).toBe("ai-lys-butikk-med-gronne-planter-pa-hyller.webp");
    expect(pictureFileName("")).toBe("ai-picture.webp");
  });
});
