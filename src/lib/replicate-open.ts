import type { Browser, BrowserContext, Page } from "playwright-core";

import { CAPTURE_NODES_MAX, CAPTURE_STYLES, SHOT_HEIGHT_MAX, VIEWPORTS, walkLive, type PageCapture, type ViewportName } from "./replicate-capture";
import { extractPage } from "./replicate-extract";
import { NO_ANSWER, WATCH, applyWatch, trackPaths, watchTracks, within } from "./replicate-watch";


/**
 * The page replicator's real browser work (D150), free of the server's own modules so a test can run it: opens the original page as a visitor would (scrolled through so lazy
 * pictures load, animations stilled, overlays hidden), photographs it, reads its boxes (`extractPage`) and photographs the
 * pictures that are drawn rather than files (icons, canvases, widgets); and opens the copy the same way to measure it. The
 * browser is told to refuse every request to a private address, whatever the page asks for.
 */

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
/** Elements photographed for want of a file, at most per page. */
const ELEMENT_SHOTS_MAX = 60;

const STILL_HEAD = "*,*::before,*::after{animation-duration:0s";
const STILL = `${STILL_HEAD}!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}html{scroll-snap-type:none!important}`;

/** What a caller may ask of opening the original. */
export type OpenOptions = {
  /** Watch the page's sliders and scrolling tracks for autoplay after the capture (computers' width only, bounded: `WATCH`). On unless false. */
  watch?: boolean;
};

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
        // Taken out of sight whole: a banner's children often say `visibility: visible` of their own.
        if (!top) (element as HTMLElement).style.setProperty("display", "none", "important");
      }
    }, VIEWPORTS.desktop.w)
    .catch(() => {});
}

async function photograph(page: Page, height: number, width: number): Promise<Buffer> {
  return page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width, height: Math.max(1, Math.min(height, SHOT_HEIGHT_MAX)) }, animations: "disabled" });
}

/**
 * One sample of each track being watched, in the page: where it is (its transform, its first tile's place, how far it is scrolled) and
 * which of its tiles show. Runs in the page, so it uses nothing from outside itself.
 */
function sampleTracks(paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const el = document.querySelector(`[data-rp-track="${path}"]`);
    if (!el) {
      out[path] = "gone";
      continue;
    }
    const cs = getComputedStyle(el);
    const kids = Array.from(el.children)
      .filter((child) => ["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].indexOf(child.tagName) < 0)
      .slice(0, 60);
    const first = kids[0] ? Math.round(kids[0].getBoundingClientRect().left * 10) / 10 : 0;
    const shown = kids
      .map((child, index) => {
        const style = getComputedStyle(child);
        return style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0.5 ? index : -1;
      })
      .filter((index) => index >= 0)
      .join(",");
    out[path] = `${cs.transform}|${first}|${Math.round((el as HTMLElement).scrollLeft)}|${shown}`;
  }
  return out;
}

/**
 * Watches the page's tracks for autoplay, after everything else is read: the stilling style is taken off and motion allowed so the
 * page's own timers and transitions run as a visitor's would, then the tracks are sampled with nobody touching the page. Bounded by
 * `WATCH` (one window, one retry, a hard total) and skipped when opening the page already took long, as the tick has a limit of its own.
 */
async function watchSliders(page: Page, capture: PageCapture, openedAt: number, signal?: AbortSignal): Promise<void> {
  const paths = trackPaths(capture);
  if (paths.length === 0) return;
  if (Date.now() - openedAt > WATCH.skipAfterMs) {
    applyWatch(capture, Object.fromEntries(paths.map((path) => [path, { observed: false as const, watchedMs: 0, why: "the page took too long to open to spare the time" }])));
    return;
  }
  // Every call to the page is bounded (`within`), the whole step by the watch's own total: a page that stops answering after it was read (its main thread
  // busy for good) must not hold the open, and so the tick, to its limit.
  const call = <T,>(promise: Promise<T>, ms: number = WATCH.callMs) => within(promise, ms);
  const stilled = await call(
    page
      .evaluate((head) => {
        for (const style of Array.from(document.querySelectorAll("style"))) if ((style.textContent || "").startsWith(head)) style.remove();
      }, STILL_HEAD)
      .catch(() => {}),
  );
  const moving = stilled === NO_ANSWER ? NO_ANSWER : await call(page.emulateMedia({ reducedMotion: "no-preference" }).catch(() => {}));
  if (stilled === NO_ANSWER || moving === NO_ANSWER) {
    applyWatch(capture, Object.fromEntries(paths.map((path) => [path, { observed: false as const, watchedMs: 0, why: "the page stopped answering" }])));
    return;
  }
  const result = await watchTracks(paths, {
    read: () => page.evaluate(sampleTracks, paths).catch(() => null),
    sleep: (ms) => page.waitForTimeout(ms),
    now: () => Date.now(),
    prepare: async (attempt) => {
      // The first track in view (the last, the second time), and the pointer out of the way: a track that waits for the visitor looks away.
      const path = paths[attempt === 0 ? 0 : paths.length - 1];
      await page.evaluate((p) => document.querySelector(`[data-rp-track="${p}"]`)?.scrollIntoView({ block: "center" }), path).catch(() => {});
      await page.mouse.move(0, 0).catch(() => {});
    },
    aborted: () => Boolean(signal?.aborted),
    retry: (paths.sliders?.length ?? 0) > 0,
  });
  applyWatch(capture, result.watches);
}

/** Opens the original at one width: its photograph, its boxes, and photographs of what is drawn rather than a file. */
export async function openOriginal(browser: Browser, url: string, viewport: ViewportName, allow: Allow, signal?: AbortSignal, options: OpenOptions = {}): Promise<Opened> {
  const openedAt = Date.now();
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
      // What lies in a slide that is not in view cannot be scrolled to and photographed; it is left to be named as not photographed.
      for (const node of walkLive(capture.root)) {
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
    if (viewport === "desktop" && options.watch !== false) await watchSliders(page, capture, openedAt, signal);
    return { capture, screenshot, elements };
  } finally {
    // A page whose main thread is busy for good may not close at once: it is given a few seconds, and the browser itself is closed by whoever opened it.
    await within(context.close().catch(() => {}), 8000);
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

