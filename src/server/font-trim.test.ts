import { readFileSync } from "node:fs";
import { join } from "node:path";

import fontverter from "fontverter";
import { describe, expect, it, vi } from "vitest";

import { fontAxes } from "@/lib/font-axes";

vi.mock("server-only", () => ({}));

const { trimFontFile } = await import("./font-trim");

/**
 * Montserrat (SIL Open Font License, `src/lib/fixtures/fonts/OFL.txt`) cut by Google's tools to the letters of "Kaizena Flow $0123456789",
 * with its whole weight axis (100 to 900, its default 100, outside what the builder installs).
 */
const SAMPLE = readFileSync(join(process.cwd(), "src/lib/fixtures/fonts/montserrat-sample.woff2"));

/** The characters a font maps (`cmap` format 4, as Google's files carry), to check that cutting the weights keeps every one. */
function characters(sfnt: Uint8Array): number[] {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  let cmap = 0;
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...sfnt.subarray(record, record + 4)) === "cmap") cmap = view.getUint32(record + 8);
  }
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const sub = cmap + view.getUint32(cmap + 4 + i * 8 + 4);
    if (view.getUint16(sub) !== 4) continue;
    const segments = view.getUint16(sub + 6) / 2;
    const out: number[] = [];
    for (let s = 0; s < segments; s++) {
      const end = view.getUint16(sub + 14 + s * 2);
      const start = view.getUint16(sub + 16 + segments * 2 + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) out.push(c);
    }
    return out;
  }
  return [];
}

const sfnt = (woff2: Uint8Array) => fontverter.convert(Buffer.from(woff2), "truetype");

describe("cutting a variable family to its installed weights (D59)", () => {
  it("keeps 400 to 700 with every character, its default moved inside, as a smaller woff2", async () => {
    const before = await sfnt(SAMPLE);
    expect(fontAxes(before)).toEqual([{ tag: "wght", min: 100, default: 100, max: 900 }]);
    const cut = await trimFontFile(SAMPLE, { min: 400, max: 700 });
    expect(cut).not.toBeNull();
    expect(fontverter.detectFormat(cut!)).toBe("woff2");
    expect(cut!.length).toBeLessThan(SAMPLE.length);
    const after = await sfnt(cut!);
    expect(fontAxes(after)).toEqual([{ tag: "wght", min: 400, default: 400, max: 700 }]);
    expect(characters(after)).toEqual(characters(before));
    expect(characters(after).length).toBeGreaterThan(20);
  });

  it("makes a file of one weight where the family has one", async () => {
    const cut = await trimFontFile(SAMPLE, { min: 300, max: 300 });
    expect(fontAxes(await sfnt(cut!))).toEqual([]);
    expect(cut!.length).toBeLessThan(SAMPLE.length);
  });

  it("leaves a file it has nothing to cut from, and does not take what is not a font", async () => {
    expect(await trimFontFile(SAMPLE, { min: 100, max: 900 })).toBeNull();
    const cut = await trimFontFile(SAMPLE, { min: 400, max: 700 });
    expect(await trimFontFile(cut!, { min: 400, max: 700 })).toBeNull();
    await expect(trimFontFile(new TextEncoder().encode("woff2 of something"), { min: 400, max: 700 })).rejects.toThrow();
  });
});
