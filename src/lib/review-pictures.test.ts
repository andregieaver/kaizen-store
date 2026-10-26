import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { checkPicture, pictureChange, pictureIdOfFile, picturePaths, readPicture } from "./review-pictures";

/** Reading a review's picture from its bytes (D301 G4): the kind and size from the header, never a name or a claimed type. */

const solid = (width: number, height: number, alpha = false) =>
  sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 10, g: 120, b: 200, alpha: 0.5 } : { r: 10, g: 120, b: 200 } } });
const bytes = async (s: ReturnType<typeof sharp>) => new Uint8Array(await s.toBuffer());

describe("readPicture", () => {
  it("reads lossy, lossless and extended WebP and JPEG", async () => {
    expect(readPicture(await bytes(solid(1600, 900).webp({ quality: 70 })))).toEqual({ type: "image/webp", width: 1600, height: 900 });
    expect(readPicture(await bytes(solid(321, 123).webp({ lossless: true })))).toEqual({ type: "image/webp", width: 321, height: 123 });
    expect(readPicture(await bytes(solid(480, 360, true).webp({ quality: 70 })))).toEqual({ type: "image/webp", width: 480, height: 360 });
    expect(readPicture(await bytes(solid(800, 600).jpeg({ quality: 70 })))).toEqual({ type: "image/jpeg", width: 800, height: 600 });
  });

  it("refuses anything else, a cut-off file and a lying length", async () => {
    expect(readPicture(await bytes(solid(10, 10).png()))).toBeNull();
    expect(readPicture(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    const webp = await bytes(solid(100, 100).webp());
    expect(readPicture(webp.slice(0, webp.length - 10))).toBeNull();
    const jpeg = await bytes(solid(100, 100).jpeg());
    expect(readPicture(jpeg.slice(0, jpeg.length - 2))).toBeNull();
    expect(readPicture(new Uint8Array(0))).toBeNull();
  });
});

describe("checkPicture", () => {
  it("takes a picture and its small copy of the same kind within the limits", async () => {
    const full = await bytes(solid(1600, 1200).webp());
    const thumb = await bytes(solid(480, 360).webp());
    expect(checkPicture({ full, thumb })).toMatchObject({ type: "image/webp", width: 1600, height: 1200 });
    // Too many pixels, a small copy that is not small, or two kinds.
    expect(checkPicture({ full: await bytes(solid(1601, 10).webp()), thumb })).toBeNull();
    expect(checkPicture({ full, thumb: await bytes(solid(481, 10).webp()) })).toBeNull();
    expect(checkPicture({ full, thumb: await bytes(solid(480, 360).jpeg()) })).toBeNull();
    // Too many bytes, whatever the header says.
    const big = new Uint8Array(600 * 1024 + 1);
    big.set(full);
    expect(checkPicture({ full: big, thumb })).toBeNull();
  });
});

describe("pictureChange", () => {
  it("keeps what is kept, takes out the rest and allows three in all", () => {
    expect(pictureChange(["a", "b"], null, 1)).toEqual({ kept: ["a", "b"], removed: [] });
    expect(pictureChange(["a", "b"], ["b", "x"], 2)).toEqual({ kept: ["b"], removed: ["a"] });
    expect(pictureChange(["a", "b"], null, 2)).toBeNull();
    expect(pictureChange([], [], 4)).toBeNull();
  });
});

describe("paths", () => {
  it("are the store's folder and the picture's id, and read back", () => {
    const id = "0b0c4a5e-1111-4222-8333-444455556666";
    const p = picturePaths("store", id, "image/webp");
    expect(p).toEqual({ full: `store/${id}.webp`, thumb: `store/${id}-480.webp` });
    expect(pictureIdOfFile(`${id}-480.webp`)).toBe(id);
    expect(pictureIdOfFile(`${id}.jpg`)).toBe(id);
    expect(pictureIdOfFile("notes.txt")).toBeNull();
  });
});
