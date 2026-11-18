import type { Page } from "@playwright/test";

/**
 * The script a page has run by the time it is idle (bloat review step 1.14, `docs/performance.md` *Time on a slow phone*): the bytes of
 * the same-origin scripts that V8 counted as run at least once, each byte of a file once, after the load, the network going idle and
 * three more seconds, as `docs/audits/bloat-review-2026-11/scripts/measure-routes.mjs` waits. Chromium only (`page.coverage`). The
 * long tasks and the largest paint it also returns are printed, never held: a timing wobbles in CI as bytes do not.
 */

/** One range of V8's block coverage: a later, inner range overrides the one around it, so a count of 0 inside a run function is not run. */
export type CoverageRange = { startOffset: number; endOffset: number; count: number };

/** The bytes of a file of `length` bytes that its `ranges` say ran, each byte once (two ranges 0-10 and 5-20, both run, are 20 bytes). */
export function mergedRunBytes(length: number, ranges: CoverageRange[]): number {
  const mark = new Uint8Array(length);
  const sorted = [...ranges].sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const range of sorted) mark.fill(range.count > 0 ? 1 : 0, range.startOffset, Math.min(range.endOffset, length));
  let used = 0;
  for (let i = 0; i < length; i += 1) used += mark[i];
  return used;
}

export type RunBytes = { runBytes: number; blockingMs: number; lcpMs: number };

export async function runBytes(page: Page, path: string, options: { cpu?: number } = {}): Promise<RunBytes> {
  const cdp = await page.context().newCDPSession(page);
  if (options.cpu) await cdp.send("Emulation.setCPUThrottlingRate", { rate: options.cpu });
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[]; __lcp: number };
    w.__long = [];
    w.__lcp = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__long.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // A browser without these entry types leaves the figures at 0.
    }
  });
  await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const entries = await page.coverage.stopJSCoverage();
  const origin = new URL(page.url()).origin;
  let used = 0;
  for (const entry of entries) {
    if (!entry.url.startsWith(`${origin}/`)) continue;
    used += mergedRunBytes(entry.source?.length ?? 0, entry.functions.flatMap((fn) => fn.ranges));
  }
  const figures = await page.evaluate(() => {
    const w = window as unknown as { __long?: number[]; __lcp?: number };
    return { long: w.__long ?? [], lcp: w.__lcp ?? 0 };
  });
  await cdp.detach().catch(() => {});
  return {
    runBytes: used,
    blockingMs: Math.round(figures.long.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0)),
    lcpMs: Math.round(figures.lcp),
  };
}
