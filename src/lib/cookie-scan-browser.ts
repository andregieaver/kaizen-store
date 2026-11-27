import type { Browser, BrowserContext, Page } from "playwright-core";

import { itemKey, sameSite, type ScannedItem, type ScannedKind, type ScanTarget } from "./cookie-scan";
import { NO_ANSWER, within } from "./replicate-watch";

/*
 * The cookie scan's browser side (D58): opening a site's pages and reading what they set. Only `cookie-scan-runner.ts` (the cookie scan's
 * own route) and the tests import it, so the routes that read a scan's findings through `cookie-scan.ts` do not carry it (the dispatcher's
 * chunk budget, ci-red #75).
 */

/** Addresses a visitor opens by following links, never ones that act or need a token. */
const SKIPPED = /^\/(api|admin|auth|_next)(\/|$)|\/(checkout|cart\/restore|unsubscribe|download|order)(\/|$)|\.[a-z0-9]{2,4}$/i;

type Found = Map<string, ScannedItem>;

/** What a page's frames keep in their storage, by frame host. */
async function storageOf(page: Page): Promise<{ kind: ScannedKind; name: string; host: string }[]> {
  const found: { kind: ScannedKind; name: string; host: string }[] = [];
  for (const frame of page.frames()) {
    let host: string;
    try {
      host = new URL(frame.url()).hostname;
    } catch {
      continue;
    }
    if (!host) continue;
    const keys = await frame
      .evaluate(() => ({ local: Object.keys(window.localStorage), session: Object.keys(window.sessionStorage) }))
      .catch(() => null);
    if (!keys) continue;
    for (const name of keys.local) found.push({ kind: "localStorage", name, host });
    for (const name of keys.session) found.push({ kind: "sessionStorage", name, host });
  }
  return found;
}

async function record(context: BrowserContext, page: Page, path: string, siteHost: string, beforeConsent: boolean, found: Found) {
  const now = Date.now();
  const add = (item: ScannedItem) => {
    const key = itemKey(item);
    if (!found.has(key)) found.set(key, item);
  };
  for (const cookie of await context.cookies()) {
    const domain = cookie.domain.replace(/^\./, "");
    add({
      kind: "cookie",
      name: cookie.name.slice(0, 200),
      domain,
      thirdParty: !sameSite(siteHost, domain),
      days: cookie.expires > 0 ? Math.max(0, Math.round((cookie.expires * 1000 - now) / 86_400_000)) : null,
      beforeConsent,
      page: path,
    });
  }
  for (const { kind, name, host } of await storageOf(page)) {
    add({ kind, name: name.slice(0, 200), domain: host, thirdParty: !sameSite(siteHost, host), days: null, beforeConsent, page: path });
  }
}

/**
 * A scan's time (incident a3cdb94e, D895): the route that runs it may take 120 seconds, Chromium's start included, so the pages get
 * `SCAN_BUDGET_MS` in all; a page waits at most `PAGE_WAIT_MS` to load and `IDLE_WAIT_MS` more for its scripts, never past the budget.
 * A page that fails counts toward `maxPages * 2` attempts, so a site of broken links cannot keep the scan opening pages until it is
 * killed. A scan cut short keeps what it found.
 */
export const SCAN_BUDGET_MS = 90_000;
const PAGE_WAIT_MS = 20_000;
const IDLE_WAIT_MS = 3_000;

/** The scan's clock: when it must stop opening pages. */
type Clock = { deadline: number; now: () => number };

/** Opens a page and lets its scripts run a moment, as a visitor would, within the scan's time. */
async function open(page: Page, url: string, clock: Clock): Promise<boolean> {
  const left = clock.deadline - clock.now();
  if (left <= 0) return false;
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: Math.min(PAGE_WAIT_MS, left) });
    await page.waitForLoadState("networkidle", { timeout: Math.max(1, Math.min(IDLE_WAIT_MS, clock.deadline - clock.now())) }).catch(() => {});
    return response !== null && response.status() < 400;
  } catch {
    return false;
  }
}

/** The site's own links on a page, as paths without query or fragment. */
async function linksOn(page: Page, target: ScanTarget): Promise<string[]> {
  const hrefs = await page.$$eval("a[href]", (links) => links.map((a) => (a as HTMLAnchorElement).href)).catch(() => []);
  const origin = new URL(target.origin).origin;
  return hrefs.flatMap((href) => {
    try {
      const url = new URL(href);
      if (url.origin !== origin || SKIPPED.test(url.pathname) || !target.within(url.pathname)) return [];
      return [url.pathname.replace(/\/$/, "") || "/"];
    } catch {
      return [];
    }
  });
}

/**
 * One visit: a new browser profile opens the site's pages (following its
 * links, or the given list) and records what it finds after each.
 */
async function visit(browser: Browser, target: ScanTarget, pages: string[] | null, beforeConsent: boolean, found: Found, clock: Clock) {
  const context = await browser.newContext({ locale: "en-GB" });
  try {
    if (!beforeConsent && target.consent) {
      await context.addCookies([{ ...target.consent, url: target.origin }]);
    }
    const page = await context.newPage();
    const siteHost = new URL(target.origin).hostname;
    const queue = [...(pages ?? target.starts)];
    const seen = new Set(queue);
    const opened: string[] = [];
    let attempts = 0;
    while (queue.length > 0 && opened.length < target.maxPages && attempts < target.maxPages * 2 && clock.now() < clock.deadline) {
      const path = queue.shift()!;
      attempts += 1;
      if (!(await open(page, new URL(path, target.origin).href, clock))) continue;
      opened.push(path);
      await record(context, page, path, siteHost, beforeConsent, found);
      // The first visit follows links; the second opens the same pages.
      if (pages === null) {
        for (const link of await linksOn(page, target)) {
          if (!seen.has(link)) {
            seen.add(link);
            queue.push(link);
          }
        }
      }
    }
    return opened;
  } finally {
    await context.close();
  }
}

/**
 * Where a scan's visits run: one browser for both (a test's, or Playwright's in e2e), or a launcher that starts a browser of its own for
 * each visit and closes it after (incident 0837a4c2). On Vercel Chromium runs as a single process, and once a context has been closed the
 * next one opened in that browser dies at `newPage` ("Target page, context or browser has been closed") or never answers: every scan
 * failed at the second visit, the one with consent, from 23 November 2026. The replicator learnt the same (`replicate-look.ts`, D150).
 */
export type ScanBrowsers = Browser | { launch: () => Promise<Browser> };

/** Runs one visit in its browser: the given one, or a fresh one closed after it, whatever happens. */
async function inBrowser<T>(browsers: ScanBrowsers, run: (browser: Browser) => Promise<T>): Promise<T> {
  if (!("launch" in browsers)) return run(browsers);
  const browser = await browsers.launch();
  try {
    return await run(browser);
  } finally {
    await within(browser.close().catch(() => {}), SCAN_CLOSE_MS);
  }
}

/** Scans a site: without a choice, then (if the site asks) with everything allowed. */
export async function scanSite(
  browsers: ScanBrowsers,
  target: ScanTarget,
  options: { budgetMs?: number; now?: () => number } = {},
): Promise<{ pages: string[]; items: ScannedItem[] }> {
  const now = options.now ?? Date.now;
  const clock: Clock = { now, deadline: now() + (options.budgetMs ?? SCAN_BUDGET_MS) };
  const found: Found = new Map();
  const pages = await inBrowser(browsers, (browser) => visit(browser, target, null, true, found, clock));
  if (pages.length === 0) throw new Error(`None of the site's pages opened at ${target.origin}.`);
  if (target.consent && clock.now() < clock.deadline) {
    await inBrowser(browsers, (browser) => visit(browser, target, pages, false, found, clock));
  }
  const items = [...found.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name),
  );
  return { pages, items };
}

/**
 * The whole scan's limit (incident a3cdb94e, reopened 26 November 2026): reading a page's cookies and storage has no time limit of its
 * own in Playwright, so a renderer that stopped answering held the scan until Vercel killed the route at 120 seconds, and the scan was
 * only marked failed ten minutes later. As the replicator does (`looking()`, D150), every browser still open is closed under a scan that
 * runs past `SCAN_LIMIT_MS`, which ends whatever it waited for, and closing is given `SCAN_CLOSE_MS`; with Chromium's start that stays
 * inside 120.
 */
export const SCAN_LIMIT_MS = 100_000;
export const SCAN_CLOSE_MS = 8_000;

/** Scans the site with a browser of its own for each visit and closes them whatever happens; a scan past `limitMs` fails with a plain sentence. */
export async function scanWithin(
  launch: () => Promise<Browser>,
  target: ScanTarget,
  limitMs: number = SCAN_LIMIT_MS,
): Promise<{ pages: string[]; items: ScannedItem[] }> {
  const open = new Set<Browser>();
  let stopped = false;
  const tracked = async () => {
    const browser = await launch();
    if (stopped) {
      await within(browser.close().catch(() => {}), SCAN_CLOSE_MS);
      throw new Error("The scan was stopped.");
    }
    open.add(browser);
    const close = browser.close.bind(browser);
    browser.close = async (...args: Parameters<Browser["close"]>) => {
      open.delete(browser);
      return close(...args);
    };
    return browser;
  };
  try {
    const running = scanSite({ launch: tracked }, target, { budgetMs: Math.min(SCAN_BUDGET_MS, limitMs) });
    // If the limit wins, `running` ends on its own once the browser is closed: its failure then is not news.
    running.catch(() => {});
    const result = await within(running, limitMs);
    if (result === NO_ANSWER) {
      throw new Error(`The scan did not finish within ${Math.round(limitMs / 1000)} seconds: a page of the site stopped answering.`);
    }
    return result;
  } finally {
    stopped = true;
    await Promise.all([...open].map((browser) => within(browser.close().catch(() => {}), SCAN_CLOSE_MS)));
  }
}
