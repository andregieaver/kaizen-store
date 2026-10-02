import type { Browser, BrowserContext, Page } from "playwright-core";

import { CAPTURE_NODES_MAX, CAPTURE_STYLES, SHOT_HEIGHT_MAX, VIEWPORTS, walk, type PageCapture, type ViewportName } from "./replicate-capture";
import { extractPage } from "./replicate-extract";


/**
 * The page replicator's real browser work (D150), free of the server's own modules so a test can run it: opens the original page as a visitor would (scrolled through so lazy
 * pictures load, animations stilled, overlays hidden), photographs it, reads its boxes (`extractPage`) and photographs the
 * pictures that are drawn rather than files (icons, canvases, widgets); and opens the copy the same way to measure it. The
 * browser is told to refuse every request to a private address, whatever the page asks for.
 */

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
/** Elements photographed for want of a file, at most per page. */
const ELEMENT_SHOTS_MAX = 60;

const STILL = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}html{scroll-snap-type:none!important}`;

export type Opened = {
  capture: PageCapture;
  /** The whole page (to `SHOT_HEIGHT_MAX`), as PNG. */
  screenshot: Buffer;
  /** Pictures that are drawn, not files, by their path in the capture. */
  elements: Map<string, Buffer>;
};

/** Decides whether the browser may make a request to an address: the replicator's server refuses private ones (`replicate-browser.ts`). */
export type Allow = (url: string) => Promise<boolean>;

/** Lets a request through only if `allow` says so. */
async function guard(context: BrowserContext, allow: Allow): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^(data|blob|about):/i.test(url)) return route.continue();
    return (await allow(url)) ? route.continue() : route.abort("blockedbyclient");
  });
}

async function newPage(browser: Browser, viewport: ViewportName, allow: Allow | null): Promise<{ page: Page; context: BrowserContext }> {
  const size = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    userAgent: viewport === "mobile" ? `${USER_AGENT.replace("X11; Linux x86_64", "Linux; Android 13; Pixel 7")} Mobile` : USER_AGENT,
    isMobile: false,
    locale: "en-GB",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  if (allow) await guard(context, allow);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return { page, context };
}

/** Scrolls the page through so what loads on the way is loaded, stills it, and hides what floats over it. */
async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: STILL }).catch(() => {});
  await page.evaluate(async () => {
    for (const image of Array.from(document.querySelectorAll("img[loading=lazy]"))) (image as HTMLImageElement).loading = "eager";
    const step = Math.max(200, Math.round(window.innerHeight * 0.8));
    let y = 0;
    const limit = Math.min(document.documentElement.scrollHeight, 30000);
    while (y < limit) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 140));
      y += step;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 250));
    window.scrollTo(0, 0);
  });
  // Pictures that are still coming, for a few seconds at most.
  await page
    .evaluate(
      () =>
        Promise.race([
          Promise.all(Array.from(document.images).map((image) => (image.complete ? null : new Promise((resolve) => { image.onload = image.onerror = () => resolve(null); })))),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]),
    )
    .catch(() => {});
  await page.waitForTimeout(350);
}

/** Hides what is fixed to the screen and is not a bar at the top (cookie banners, chat widgets, pop-ups), as the capture leaves it out. */
async function hideOverlays(page: Page): Promise<void> {
  await page
    .evaluate((width) => {
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const style = getComputedStyle(element);
        if (style.position !== "fixed") continue;
        const rect = element.getBoundingClientRect();
        const top = rect.top <= 4 && rect.height <= 220 && rect.width >= width * 0.8;
        if (!top) (element as HTMLElement).style.setProperty("visibility", "hidden", "important");
      }
    }, VIEWPORTS.desktop.w)
    .catch(() => {});
}

async function photograph(page: Page, height: number, width: number): Promise<Buffer> {
  return page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width, height: Math.max(1, Math.min(height, SHOT_HEIGHT_MAX)) }, animations: "disabled" });
}

/** Opens the original at one width: its photograph, its boxes, and photographs of what is drawn rather than a file. */
export async function openOriginal(browser: Browser, url: string, viewport: ViewportName, allow: Allow, signal?: AbortSignal): Promise<Opened> {
  const { page, context } = await newPage(browser, viewport, allow);
  try {
    if (signal?.aborted) throw new Error("Stopped.");
    const response = await page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch((error: Error) => {
      throw new Error(/ERR_BLOCKED_BY_CLIENT/.test(error.message) ? "That address is on a private network." : /Timeout/.test(error.message) ? "The page took too long to load." : "The page could not be opened.");
    });
    if (response && response.status() >= 400) throw new Error(`The site answered ${response.status()} for the page.`);
    if (response && !/html|xml/i.test(response.headers()["content-type"] ?? "html")) throw new Error("That address is not a web page.");
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await settle(page);
    await hideOverlays(page);
    const size = VIEWPORTS[viewport];
    const read = await page.evaluate(extractPage, { maxNodes: CAPTURE_NODES_MAX, styles: CAPTURE_STYLES, width: size.w, height: size.h });
    const capture: PageCapture = { ...read, viewport: size, url: page.url() };
    const screenshot = await photograph(page, capture.docHeight, size.w);
    const elements = new Map<string, Buffer>();
    if (viewport === "desktop") {
      for (const node of walk(capture.root)) {
        if (elements.size >= ELEMENT_SHOTS_MAX) break;
        const media = node.media;
        const drawn = media?.kind === "svg" || media?.kind === "canvas" || (media?.kind === "embed" && !/youtube|vimeo/i.test(media.url));
        if (!drawn || node.box[2] < 4 || node.box[3] < 4 || node.box[2] > 3000 || node.box[3] > 3000) continue;
        const picture = await page
          .locator(`[data-rp="${node.p}"]`)
          .first()
          .screenshot({ type: "png", omitBackground: true, timeout: 4000, animations: "disabled" })
          .catch(() => null);
        if (picture) elements.set(node.p, picture);
      }
    }
    return { capture, screenshot, elements };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Opens the copy (its preview page on this site) at one width, and measures it as the original was. */
export async function openCopy(browser: Browser, frameUrl: string, viewport: ViewportName): Promise<Opened> {
  const { page, context } = await newPage(browser, viewport, null);
  try {
    const response = await page.goto(frameUrl, { waitUntil: "load", timeout: 40_000 });
    if (!response || response.status() >= 400) throw new Error("The copy could not be opened to be measured.");
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    // The page's fonts and pictures, for a few seconds at most.
    await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => null) : null)).catch(() => {});
    await settle(page);
    const size = VIEWPORTS[viewport];
    const read = await page.evaluate(extractPage, { maxNodes: CAPTURE_NODES_MAX, styles: CAPTURE_STYLES, width: size.w, height: size.h });
    const capture: PageCapture = { ...read, viewport: size, url: frameUrl };
    const screenshot = await photograph(page, capture.docHeight, size.w);
    return { capture, screenshot, elements: new Map() };
  } finally {
    await context.close().catch(() => {});
  }
}

