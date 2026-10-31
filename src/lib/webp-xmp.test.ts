import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { webpHasXmp, withWebpXmp } from "./webp-xmp";

const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
  'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:DigitalSourceType>' +
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></rdf:Description></rdf:RDF></x:xmpmeta>";

/** A small picture with a gradient, so a re-encoding would change pixels. */
async function picture(options: { alpha?: boolean; lossless?: boolean; xmp?: boolean }) {
  const channels = options.alpha ? 4 : 3;
  const width = 37;
  const height = 21;
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + (i % channels) * 50) % 256;
  let image = sharp(raw, { raw: { width, height, channels } }).webp({ quality: 70, lossless: Boolean(options.lossless) });
  if (options.xmp) image = image.withXmp("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"/>");
  return new Uint8Array(await image.toBuffer());
}

const pixels = async (bytes: Uint8Array) => (await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
const canvas = async (bytes: Uint8Array) => {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width!, height: meta.height!, alpha: Boolean(meta.hasAlpha) };
};

describe("an XMP packet written into a WebP file without re-encoding it (AI Act Art. 50(2))", () => {
  for (const [name, options] of [
    ["lossy", {}],
    ["lossless", { lossless: true }],
    ["with alpha", { alpha: true }],
    ["already extended, with an older XMP", { xmp: true }],
  ] as const) {
    it(`marks a ${name} file and leaves every pixel as it was`, async () => {
      const before = await picture(options);
      const after = withWebpXmp(before, XMP, await canvas(before));
      const [a, b] = await Promise.all([pixels(before), pixels(after)]);
      expect(b.info).toMatchObject({ width: a.info.width, height: a.info.height, channels: a.info.channels });
      expect(Buffer.compare(a.data, b.data)).toBe(0);
      const meta = await sharp(after).metadata();
      expect(meta.xmp?.toString()).toContain("trainedAlgorithmicMedia");
      expect(webpHasXmp(after)).toBe(XMP);
      // Marked again: still one XMP chunk.
      const twice = withWebpXmp(after, XMP, await canvas(after));
      expect(Buffer.from(twice).toString("latin1").split("XMP ").length - 1).toBe(1);
      expect(Buffer.compare((await pixels(twice)).data, a.data)).toBe(0);
    });
  }

  it("says a file has no XMP, and refuses what is not WebP", async () => {
    expect(webpHasXmp(await picture({}))).toBeNull();
    const png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer());
    expect(() => webpHasXmp(png)).toThrow("Not a WebP file.");
    expect(() => withWebpXmp(png, XMP, { width: 2, height: 2, alpha: false })).toThrow();
  });
});
