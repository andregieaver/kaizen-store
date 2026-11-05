/**
 * `subset-font` (BSD-3-Clause, HarfBuzz's subsetter in WebAssembly) and `fontverter` (BSD-3-Clause, woff2 in WebAssembly) have no types
 * of their own: the calls the font trimmer makes (`src/server/font-trim.ts`).
 */
declare module "subset-font" {
  type Format = "truetype" | "woff" | "woff2";
  function subsetFont(
    font: Buffer | Uint8Array,
    text: string | null,
    options?: {
      targetFormat?: Format;
      keepAllGlyphs?: boolean;
      variationAxes?: Record<string, number | { min: number; max: number; default?: number }>;
    },
  ): Promise<Buffer>;
  export default subsetFont;
}

declare module "fontverter" {
  const fontverter: {
    convert(font: Buffer | Uint8Array, to: "truetype" | "woff" | "woff2", from?: "truetype" | "woff" | "woff2"): Promise<Buffer>;
    detectFormat(font: Buffer | Uint8Array): "truetype" | "woff" | "woff2";
  };
  export default fontverter;
}
