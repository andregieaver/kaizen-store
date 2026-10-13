import type { AVIFModule } from "@jsquash/avif/codec/enc/avif_enc.js";

/**
 * AVIF from pixels in the browser (D213), with `@jsquash/avif`'s single-threaded WebAssembly encoder, loaded the first
 * time it is asked for. Its own `encode.js` also imports the encoder's multi-threaded build, which starts a worker the
 * admin never could use (threads need a cross-origin isolated page) and which the production build hangs on; this takes
 * the single-threaded build directly. Its WebAssembly file is found beside the module (`new URL(..., import.meta.url)`).
 */

let loading: Promise<AVIFModule> | null = null;

async function encoder(): Promise<AVIFModule> {
  loading ??= Promise.all([import("@jsquash/avif/codec/enc/avif_enc.js"), import("@jsquash/avif/utils.js")]).then(
    ([{ default: factory }, { initEmscriptenModule }]) => initEmscriptenModule(factory) as Promise<AVIFModule>,
  );
  return loading;
}

/** The encoder's defaults (`@jsquash/avif`'s `meta.js`), as written there: chroma subsampling 4:2:0, 8 bits, tuned automatically. */
const DEFAULTS = {
  qualityAlpha: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  subsample: 1,
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0,
  enableSharpYUV: false,
  bitDepth: 8,
};

/** The picture as AVIF at `quality` (0 to 100) and `speed` (0 slowest to 10 fastest). */
export async function encodeAvif(pixels: ImageData, options: { quality: number; speed: number }): Promise<ArrayBuffer> {
  const avif = await encoder();
  const output = avif.encode(new Uint8Array(pixels.data.buffer), pixels.width, pixels.height, { ...DEFAULTS, ...options });
  if (!output) throw new Error("The picture could not be written as AVIF.");
  return output.buffer as ArrayBuffer;
}
