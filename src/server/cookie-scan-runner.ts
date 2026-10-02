import "server-only";

import { sql } from "drizzle-orm";
import type { Browser } from "playwright-core";

import { db } from "@/db/client";
import { scanSite } from "@/lib/cookie-scan";

import { launchBrowser } from "./browser";
import { claimScan, scanTarget } from "./cookie-scans";

/** Runs a claimed scan to the end, recording what it found or why it failed. */
export async function runScan(
  scan: { id: string; storeId: string | null },
  launch: () => Promise<Browser> = launchBrowser,
): Promise<void> {
  let browser: Browser | null = null;
  try {
    const target = await scanTarget(scan.storeId);
    if (!target) throw new Error("The site is not open, so there is nothing to scan.");
    browser = await launch();
    const { pages, items } = await scanSite(browser, target);
    await db().execute(sql`
      update commerce.cookie_scans
      set status = 'done', finished_at = now(), pages = ${JSON.stringify(pages)}::jsonb,
        items = ${JSON.stringify(items)}::jsonb, error = null
      where id = ${scan.id}::uuid
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db().execute(sql`
      update commerce.cookie_scans set status = 'failed', finished_at = now(), error = ${message.slice(0, 500)}
      where id = ${scan.id}::uuid
    `);
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** The scheduler's turn: the next scan, if any is due. */
export async function runNextScan(launch?: () => Promise<Browser>): Promise<{ scanned: string | null }> {
  const scan = await claimScan();
  if (!scan) return { scanned: null };
  await runScan(scan, launch);
  return { scanned: scan.id };
}
