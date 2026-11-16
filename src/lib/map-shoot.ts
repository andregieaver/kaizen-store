import type { Browser } from "playwright-core";

import type { MapLayout } from "./heat-read";
import { measureAnchors } from "./map-measure";
import { settle } from "./page-look-shoot";

/**
 * Photographs a store page for its heatmap (D656, `docs/heatmaps-and-recordings.md` 9.2): the page opened as a visitor who refused every
 * optional cookie (so the banner stays closed and no tool loads), with the A/B version's cookies when a version is asked for, settled as
 * page looks are, measured (`measureAnchors()`), and photographed full length up to `MAP_LENGTH_MAX`. The chat's launcher and private parts
 * are hidden. Free of server-only modules: a browser test runs it; the job calls it inside `looking()` with a browser of its own.
 */

export const MAP_LENGTH_MAX = 10_000;

export type MapViewport = { width: number; height: number; mobile: boolean };
export type MapCookie = { name: string; value: string };
export type MapShot = { picture: Buffer; layout: MapLayout };

const OPEN_MS = 30_000;
const IDLE_MS = 8000;

export async function shootMap(browser: Browser, url: string, viewport: MapViewport, cookies: readonly MapCookie[]): Promise<MapShot> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    reducedMotion: "reduce",
  });
  try {
    if (cookies.length > 0) await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url })));
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: OPEN_MS }).catch((error: unknown) => {
      if (error instanceof Error && /ERR_HTTP_RESPONSE_CODE_FAILURE/.test(error.message)) throw new Error("The page answered with an error, so it could not be photographed.");
      throw error;
    });
    if (!response || response.status() >= 400) throw new Error(`The page answered ${response ? response.status() : "nothing"}, so it could not be photographed.`);
    await page.waitForLoadState("networkidle", { timeout: IDLE_MS }).catch(() => {});
    await page.addStyleTag({ content: "[data-chat-launcher], [data-kz-private] { visibility: hidden !important }" });
    await settle(page);
    const layout = await page.evaluate(measureAnchors);
    const height = Math.max(viewport.height, Math.min(layout.h, MAP_LENGTH_MAX));
    const picture = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height } });
    return { picture, layout };
  } finally {
    await context.close().catch(() => {});
  }
}
