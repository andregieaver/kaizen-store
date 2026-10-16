#!/usr/bin/env node
/**
 * Draws a signature theme's art (`docs/signature-themes.md`): each picture a recipe in `scripts/theme-art/{theme}.js`, drawn on a canvas in
 * Chromium with the helpers of `scripts/theme-art/lib.js` from a fixed seed, so the same every time, and saved as WebP in
 * `public/demo/themes/{theme}/`. A developer tool, run by hand after changing a recipe; the app never imports it.
 *
 *   node scripts/theme-art.mjs orbit            every picture of Orbit
 *   node scripts/theme-art.mjs orbit hero saturn some of them
 *
 * Chromium is the one Playwright knows, or `PLAYWRIGHT_CHROMIUM_PATH`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const [theme, ...only] = process.argv.slice(2);
if (!theme || !/^[a-z][a-z0-9-]*$/.test(theme)) {
  console.error("Name a theme: node scripts/theme-art.mjs orbit [picture …]");
  process.exit(1);
}

const lib = await readFile(path.join(here, "theme-art", "lib.js"), "utf8");
const recipes = await readFile(path.join(here, "theme-art", `${theme}.js`), "utf8");
const out = path.join(here, "..", "public", "demo", "themes", theme);
await mkdir(out, { recursive: true });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: lib });
  await page.addScriptTag({ content: recipes });
  const names = await page.evaluate(() => Object.keys(window.ART));
  const wanted = only.length > 0 ? names.filter((n) => only.includes(n)) : names;
  for (const name of wanted) {
    const started = Date.now();
    const result = await page.evaluate((key) => {
      const recipe = window.ART[key];
      const c = document.createElement("canvas");
      c.width = recipe.w;
      c.height = recipe.h;
      recipe.draw(c.getContext("2d"), recipe.w, recipe.h, window.ARTLIB);
      return { url: c.toDataURL("image/png"), quality: recipe.quality ?? 82, alpha: Boolean(recipe.alpha) };
    }, name);
    const png = Buffer.from(result.url.split(",")[1], "base64");
    const webp = await sharp(png).webp({ quality: result.quality, alphaQuality: result.alpha ? 90 : 100, effort: 6, smartSubsample: true }).toBuffer();
    await writeFile(path.join(out, `${name}.webp`), webp);
    const meta = await sharp(webp).metadata();
    console.log(`${theme}/${name}.webp ${meta.width}x${meta.height} ${Math.round(webp.length / 1024)} KB (${Date.now() - started} ms)`);
  }
} finally {
  await browser.close();
}
