import "server-only";

import type { Browser } from "playwright-core";

/**
 * Chromium for what needs a real browser (the cookie scan, D58; the page replicator, D150): the sandbox's own when
 * `PLAYWRIGHT_CHROMIUM_PATH` is set, the serverless build on Vercel, else Playwright's download. Only the routes that
 * need it import this, so the other routes do not carry Chromium.
 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const local = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (local) return chromium.launch({ executablePath: local, headless: true });
  if (process.env.VERCEL) {
    const { default: serverless } = await import("@sparticuz/chromium");
    serverless.setGraphicsMode = false;
    return chromium.launch({ executablePath: await serverless.executablePath(), args: serverless.args, headless: true });
  }
  return chromium.launch({ headless: true });
}
