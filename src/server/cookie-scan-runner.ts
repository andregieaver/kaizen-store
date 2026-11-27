import "server-only";

import { sql } from "drizzle-orm";
import type { Browser } from "playwright-core";

import { db } from "@/db/client";
import { scanWithin } from "@/lib/cookie-scan";

import { launchBrowser } from "./browser";
import { scanTarget } from "./cookie-scans";

/**
 * How a scan ended. `failed` is a broken scan (the browser or a page let it down), which the job counts as a failed run; `closed` is a
 * site that is not open, a normal answer (incident 74c699bf: every scan failed for three days while the job showed no failures).
 */
export type ScanOutcome = { status: "done" } | { status: "closed" } | { status: "failed"; error: string };

const CLOSED = "The site is not open, so there is nothing to scan.";

/** Runs a claimed scan to the end, recording what it found or why it failed on the scan's row, and answers how it ended. */
export async function runScan(
  scan: { id: string; storeId: string | null },
  launch: () => Promise<Browser> = launchBrowser,
): Promise<ScanOutcome> {
  try {
    const target = await scanTarget(scan.storeId);
    if (!target) {
      await markFailed(scan.id, CLOSED);
      return { status: "closed" };
    }
    const { pages, items } = await scanWithin(launch, target);
    await db().execute(sql`
      update commerce.cookie_scans
      set status = 'done', finished_at = now(), pages = ${JSON.stringify(pages)}::jsonb,
        items = ${JSON.stringify(items)}::jsonb, error = null
      where id = ${scan.id}::uuid
    `);
    return { status: "done" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(scan.id, message);
    return { status: "failed", error: message };
  }
}

async function markFailed(id: string, message: string) {
  await db().execute(sql`
    update commerce.cookie_scans set status = 'failed', finished_at = now(), error = ${message.slice(0, 500)}
    where id = ${id}::uuid
  `);
}

