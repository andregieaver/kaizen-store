import type { Browser, Page } from "playwright-core";

import { SHOT_LENGTH_MAX, SHOT_SCREENS, type ShotKind, type ShotParts } from "./theme-shots";

/**
 * Photographs one look of a theme at one width (`docs/theme-showcase-phase-2.md` step 1): the theme's public preview on its showcase store,
 * drawn alone (`embed=1`). Free of server-only modules, so a browser test runs it against a running preview; the job calls it inside
 * `looking()` with a browser of its own (D150's rule).
 */

/** What one look at one width gives: the page at full length (one pixel per CSS pixel), its first screen (at the width's scale) and its parts. */
export type Shot = { full: Buffer; screen: Buffer; parts: ShotParts };

/** How long the page is given to open, and its pictures and fonts to arrive. */
const OPEN_MS = 30_000;
const IDLE_MS = 8000;
const PICTURES_MS = 6000;

async function settle(page: Page): Promise<void> {
  // Pictures the page loads late, now; then the page scrolled through, so what loads on the way is loaded.
  await page.evaluate(async () => {
    for (const image of Array.from(document.querySelectorAll("img[loading=lazy]"))) (image as HTMLImageElement).loading = "eager";
    const step = Math.max(200, Math.round(window.innerHeight * 0.8));
    const limit = Math.min(document.documentElement.scrollHeight, 12000);
    for (let y = 0; y < limit; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await page
    .evaluate(
      (ms) =>
        Promise.race([
          Promise.all([
            document.fonts ? document.fonts.ready : null,
            ...Array.from(document.images).map((image) => (image.complete ? null : new Promise((resolve) => { image.onload = image.onerror = () => resolve(null); }))),
          ]),
          new Promise((resolve) => setTimeout(resolve, ms)),
        ]),
      PICTURES_MS,
    )
    .catch(() => {});
  await page.waitForTimeout(400);
}

/** The page's parts, measured in the page (so it uses nothing from outside itself): the preview marks them with `data-shot`. */
function measure(max: number): ShotParts {
  const top = (element: Element) => element.getBoundingClientRect().top + window.scrollY;
  const box = (element: Element | null) => (element ? { top: Math.round(top(element)), height: Math.round(element.getBoundingClientRect().height) } : null);
  const length = Math.min(Math.round(document.documentElement.scrollHeight), max);
  const main = document.querySelector("main");
  const mainBox = box(main);
  const article = document.querySelector('[data-shot="front"] article');
  const rows = article ? Array.from(article.children).map((row) => box(row)!).filter((row) => row.height > 0 && row.top < length) : [];
  const footerTop = mainBox ? mainBox.top + mainBox.height : null;
  return {
    length,
    header: mainBox && mainBox.top > 0 ? { top: 0, height: mainBox.top } : null,
    rows,
    product: box(document.querySelector('[data-shot="product"]')),
    footer: footerTop !== null && footerTop < length ? { top: footerTop, height: length - footerTop } : null,
  };
}

/** Opens `url` at the width of `kind`, waits for it, and photographs it. The browser itself is closed by whoever opened it. */
export async function shootLook(browser: Browser, url: string, kind: ShotKind): Promise<Shot> {
  const screen = SHOT_SCREENS[kind];
  const context = await browser.newContext({
    viewport: { width: screen.width, height: screen.height },
    deviceScaleFactor: screen.scale,
    locale: "en-GB",
    // Entrances shown as they end, and nothing moving while it is photographed.
    reducedMotion: "reduce",
    colorScheme: "light",
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const response = await page.goto(url, { waitUntil: "load", timeout: OPEN_MS });
    if (!response || response.status() >= 400) throw new Error(`The preview answered ${response?.status() ?? "nothing"}.`);
    await page.waitForLoadState("networkidle", { timeout: IDLE_MS }).catch(() => {});
    // A preview that is not there streams its not-found page with a 200: only a page that drew the theme is photographed.
    if ((await page.locator("[data-design-preview]").count()) === 0) throw new Error("The preview did not show the theme (it may no longer be published).");
    await settle(page);
    const parts = await page.evaluate(measure, SHOT_LENGTH_MAX);
    const full = await page.screenshot({
      type: "png",
      fullPage: true,
      clip: { x: 0, y: 0, width: screen.width, height: Math.max(1, parts.length) },
      scale: "css",
      animations: "disabled",
    });
    const first = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: screen.width, height: Math.min(screen.height, parts.length) }, scale: "device", animations: "disabled" });
    return { full, screen: first, parts };
  } finally {
    await context.close().catch(() => {});
  }
}
