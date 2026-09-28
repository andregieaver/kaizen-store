import { describe, expect, it } from "vitest";

import { describeType, formatBytes, imageSize } from "./image-size";

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

describe("a picture's size from its first bytes (D88)", () => {
  it("reads PNG", () => {
    const png = bytes([0x89], "PNG\r\n", [0x1a, 0x0a], be32(13), "IHDR", be32(1600), be32(900), [8, 6, 0, 0, 0]);
    expect(imageSize(png)).toEqual({ width: 1600, height: 900 });
  });

  it("reads GIF", () => {
    expect(imageSize(bytes("GIF89a", le16(320), le16(200), [0, 0, 0]))).toEqual({ width: 320, height: 200 });
  });

  it("reads lossy, lossless and extended WebP", () => {
    const riff = (chunk: string, body: number[]) => bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], body);
    expect(imageSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1600), ...le16(1200)]))).toEqual({ width: 1600, height: 1200 });
    // Lossless: 14 bits each of width and height less one, after the 0x2f signature.
    const packed = (480 - 1) | ((360 - 1) << 14);
    expect(imageSize(riff("VP8L", [0x2f, packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, (packed >>> 24) & 255, 0]))).toEqual({
      width: 480,
      height: 360,
    });
    expect(imageSize(riff("VP8X", [0x10, 0, 0, 0, ...le24(4000 - 1), ...le24(3000 - 1)]))).toEqual({ width: 4000, height: 3000 });
  });

  it("reads AVIF from its ispe property", () => {
    const avif = bytes(be32(28), "ftyp", "avif", be32(0), "mif1miaf", be32(20), "meta", be32(0), be32(20), "ispe", be32(0), be32(1920), be32(1080));
    expect(imageSize(avif)).toEqual({ width: 1920, height: 1080 });
    // An AVIF cut off before its size gives nothing, to be measured when shown.
    expect(imageSize(avif.subarray(0, 40))).toBeNull();
  });

  it("walks JPEG segments to the frame", () => {
    const app0 = [0xff, 0xe0, ...be16(16), ...bytes("JFIF", [0], [1, 1, 0], be16(72), be16(72), [0, 0])];
    const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(768), ...be16(1024), 3];
    expect(imageSize(Uint8Array.from([0xff, 0xd8, ...app0, ...sof, 0, 0, 0, 0]))).toEqual({ width: 1024, height: 768 });
    // A progressive frame too.
    const sof2 = [0xff, 0xc2, ...be16(17), 8, ...be16(50), ...be16(60), 3];
    expect(imageSize(Uint8Array.from([0xff, 0xd8, ...sof2, 0, 0, 0, 0]))).toEqual({ width: 60, height: 50 });
  });

  it("gives nothing for other files or damaged ones", () => {
    expect(imageSize(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSize(bytes("GIF89a", le16(0), le16(200), [0, 0, 0]))).toBeNull();
  });
});

describe("file details for people", () => {
  it("writes sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 kB");
    expect(formatBytes(123_456)).toBe("123 kB");
    expect(formatBytes(4_500_000)).toBe("4.5 MB");
  });

  it("names types", () => {
    expect(describeType("image/webp")).toBe("WebP picture");
    expect(describeType("image/avif")).toBe("AVIF picture");
    expect(describeType("image/svg+xml")).toBe("SVG picture");
    expect(describeType("video/mp4")).toBe("MP4 video");
    expect(describeType("application/pdf")).toBe("application/pdf");
  });
});
