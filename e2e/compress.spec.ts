import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import ts from "typescript";

/**
 * Compressing pictures in the browser (D213), in a real Chromium: canvas WebP, the measured quality, and the AVIF encoder's
 * WebAssembly. The modules are served as they are written (TypeScript translated file by file, the encoder's own files),
 * so nothing is bundled differently from what the admin loads. Videos are not here: this Chromium cannot encode H.264,
 * which compressing a video needs (`canCompressVideo()`), so it would only show the fallback, the original going up.
 */

const ORIGIN = "http://compress.test";
const root = process.cwd();
const require = createRequire(join(root, "node_modules/@jsquash/avif/package.json"));
const jsquash = dirname(require.resolve("@jsquash/avif/package.json"));

const PAGE = `<!doctype html><script type="importmap">${JSON.stringify({
  imports: { "@jsquash/avif/": "/jsquash/" },
})}</script>
<script type="module">
  import { compressPicture } from "/src/lib/image-compress.js";
  import { encodeAvif } from "/src/lib/avif-encode.js";
  window.compressPicture = compressPicture;
  window.encodeAvif = encodeAvif;
  window.ready = true;
</script>`;

function translated(path: string): string {
  const source = readFileSync(join(root, path.replace(/\.js$/, ".ts")), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return outputText.replace(/(from |import\()"(\.\/[\w-]+)"/g, '$1"$2.js"');
}

async function open(page: Page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const js = (body: string | Buffer) => route.fulfill({ body, contentType: "text/javascript" });
    if (path === "/") return route.fulfill({ body: PAGE, contentType: "text/html" });
    if (path.startsWith("/src/lib/")) return js(translated(path.slice(1)));
    if (path.startsWith("/jsquash/")) {
      const file = join(jsquash, path.slice("/jsquash/".length));
      return file.endsWith(".wasm") ? route.fulfill({ body: readFileSync(file), contentType: "application/wasm" }) : js(readFileSync(file));
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
}

type Result = { type: string; width: number; height: number; size: number; plain: number; same: boolean; quality: number };

/** A photo-like picture drawn in the page (soft light, fine grain), compressed, against the same at a fixed 95 %. */
async function compress(page: Page, options: { avif: boolean; alpha?: boolean; width?: number; height?: number }): Promise<Result> {
  return page.evaluate(async ({ avif, alpha, width = 2000, height = 1300 }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    const light = context.createLinearGradient(0, 0, width, height);
    light.addColorStop(0, "#2b5876");
    light.addColorStop(0.5, "#c9a26b");
    light.addColorStop(1, "#4e4376");
    context.fillStyle = light;
    context.fillRect(0, 0, width, height);
    // Texture with a structure, as surfaces have (pure noise is not a photo and cannot be compressed).
    const grain = context.getImageData(0, 0, width, height);
    for (let i = 0; i < grain.data.length; i += 4) {
      const x = (i / 4) % width;
      const y = Math.floor(i / 4 / width);
      const n = 10 * Math.sin(x / 7 + Math.cos(y / 11) * 3) + 6 * Math.sin((x + 2 * y) / 23);
      grain.data[i] += n;
      grain.data[i + 1] += n * 0.8;
      grain.data[i + 2] += n * 0.6;
      if (alpha) grain.data[i + 3] = x < width / 2 ? 255 : 90;
    }
    context.putImageData(grain, 0, 0);
    const file = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    const compressPicture = (window as unknown as { compressPicture: (file: Blob, max: number, options: { avif: boolean }) => Promise<{ blob: Blob; type: string; width: number; height: number; quality: number; likeness: { luma: number; lumaLow: number; chroma: number; lumaFull?: number } }> }).compressPicture;
    const result = await compressPicture(file, 1600, { avif });
    const resized = document.createElement("canvas");
    resized.width = result.width;
    resized.height = result.height;
    resized.getContext("2d")!.drawImage(canvas, 0, 0, result.width, result.height);
    const plain = await new Promise<Blob>((resolve) => resized.toBlob((blob) => resolve(blob!), "image/webp", 0.95));
    const l = result.likeness;
    const same = l.luma >= 0.985 && l.lumaLow >= 0.93 && l.chroma >= 0.97 && (l.lumaFull === undefined || l.lumaFull >= 0.975);
    return { type: result.type, width: result.width, height: result.height, size: result.blob.size, plain: plain.size, same, quality: result.quality };
  }, options);
}

test.describe("compressing a picture in the browser (D213)", () => {
  test.setTimeout(90_000);

  test("makes it 1600 pixels at most, smaller than the highest quality, and still the same to the eye", async ({ page }) => {
    await open(page);
    const result = await compress(page, { avif: false });
    expect(result.type).toBe("image/webp");
    expect([result.width, result.height]).toEqual([1600, 1040]);
    expect(result.same).toBe(true);
    expect(result.quality).toBeLessThan(0.95);
    expect(result.size).toBeLessThan(result.plain);
  });

  test("writes AVIF with its WebAssembly encoder where asked, when it is clearly smaller", async ({ page }) => {
    await open(page);
    const webp = await compress(page, { avif: false });
    const avif = await compress(page, { avif: true });
    expect(avif.same).toBe(true);
    // AVIF is kept only when at least a tenth smaller; otherwise the WebP stays.
    if (avif.type === "image/avif") expect(avif.size).toBeLessThan(webp.size * 0.9);
    else expect(avif.type).toBe("image/webp");
    expect(["image/avif", "image/webp"]).toContain(avif.type);
  });

  test("writes an AVIF the browser reads back at its size", async ({ page }) => {
    await open(page);
    const read = await page.evaluate(async () => {
      const pixels = new ImageData(64, 48);
      for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set([(i / 4) % 64 * 4, 120, 200, 255], i);
      const encodeAvif = (window as unknown as { encodeAvif: (p: ImageData, o: { quality: number; speed: number }) => Promise<ArrayBuffer> }).encodeAvif;
      const bytes = await encodeAvif(pixels, { quality: 60, speed: 8 });
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/avif" }));
      return { size: bytes.byteLength, width: bitmap.width, height: bitmap.height };
    });
    expect(read.size).toBeGreaterThan(100);
    expect([read.width, read.height]).toEqual([64, 48]);
  });

  test("keeps what is see-through, and a small picture at its own size", async ({ page }) => {
    await open(page);
    const result = await compress(page, { avif: false, alpha: true, width: 600, height: 400 });
    expect([result.width, result.height]).toEqual([600, 400]);
    expect(result.same).toBe(true);
  });
});

