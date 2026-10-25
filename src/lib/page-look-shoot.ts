import type { Browser, Page } from "playwright-core";

import { LOOK_LENGTH_MAX, LOOK_WIDTHS, type LookWidth, type ShotFacts } from "./page-look";

/**
 * Photographs a page at one width and measures it (D310, `docs/ai-autopilot.md` 9.2): the page opened, its lazy pictures loaded and scrolled
 * through, then photographed full length (at most `LOOK_LENGTH_MAX` CSS pixels) and measured in the page itself. Free of server-only modules,
 * so a browser test runs it against a small page; the job calls it inside `looking()` with a browser of its own (D150's rule).
 */

export type LookShot = { picture: Buffer; facts: ShotFacts };

const OPEN_MS = 30_000;
const IDLE_MS = 8000;
const PICTURES_MS = 6000;

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const image of Array.from(document.querySelectorAll("img[loading=lazy]"))) (image as HTMLImageElement).loading = "eager";
    const step = Math.max(200, Math.round(window.innerHeight * 0.8));
    const limit = Math.min(document.documentElement.scrollHeight, 12000);
    for (let y = 0; y < limit; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.scrollTo(0, 0);
  });
  await page
    .evaluate(
      (ms) =>
        Promise.race([
          Promise.all([
            document.fonts ? document.fonts.ready : null,
            ...Array.from(document.images).map((image) =>
              image.complete
                ? null
                : new Promise((resolve) => {
                    image.onload = image.onerror = () => resolve(null);
                  }),
            ),
          ]),
          new Promise((resolve) => setTimeout(resolve, ms)),
        ]),
      PICTURES_MS,
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * What code reads in the page: measured in the page, so it uses nothing from outside itself. `width` is the screen's: a phone widens its
 * layout to fit a page that is too wide, so the page is compared with the screen it was opened on, not with the window it made.
 */
function measure(width: number): ShotFacts {
  const root = document.documentElement;
  const sideways = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) > width + 2;
  const brokenPictures = Array.from(document.images).filter((image) => image.complete && image.naturalWidth === 0 && Boolean(image.currentSrc || image.src)).length;
  const words = (document.body?.innerText ?? "").split(/\s+/).filter(Boolean).length;
  const firstScreen = window.innerHeight;
  const header = document.querySelector("header");
  const below = header ? header.getBoundingClientRect().bottom : 0;
  const actionInFirstScreen = Array.from(document.querySelectorAll("a[href], button")).some((element) => {
    if (header && header.contains(element)) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && box.top < firstScreen && box.bottom > below && style.visibility !== "hidden" && style.display !== "none";
  });
  return { sideways, brokenPictures, words, actionInFirstScreen };
}

/** One look at one width, in a browser the caller owns (and closes). */
export async function shootPage(browser: Browser, url: string, width: LookWidth): Promise<LookShot> {
  const size = LOOK_WIDTHS[width];
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    isMobile: width === "phone",
    hasTouch: width === "phone",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: OPEN_MS }).catch((error: unknown) => {
      // An error page with nothing in it fails in the browser itself.
      if (error instanceof Error && /ERR_HTTP_RESPONSE_CODE_FAILURE/.test(error.message)) throw new Error("The page answered with an error, so it could not be looked at.");
      throw error;
    });
    if (!response || response.status() >= 400) throw new Error(`The page answered ${response ? response.status() : "nothing"}, so it could not be looked at.`);
    await page.waitForLoadState("networkidle", { timeout: IDLE_MS }).catch(() => {});
    await settle(page);
    const facts = await page.evaluate(measure, size.width);
    const length = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), LOOK_LENGTH_MAX);
    const picture = await page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y: 0, width: size.width, height: Math.max(size.height, length) }, fullPage: true });
    return { picture, facts };
  } finally {
    await context.close().catch(() => {});
  }
}
