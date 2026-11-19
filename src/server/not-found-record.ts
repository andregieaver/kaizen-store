import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { NOT_FOUND_DAY_CAP, NOT_FOUND_THROTTLE_MS } from "@/lib/data-limits";
import { recordablePath } from "@/lib/not-found";
import { normalisePath } from "@/lib/redirect-path";

import { log } from "./log";

/**
 * Recording a request for a missing address for the 404 report (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.3): the one caller of
 * `commerce.record_not_found()`, moved here from `not-found.ts` (which re-exports it and keeps the report's readers and writers) so the
 * proxy and the store's routes record a miss without loading the report, the admin's permissions or the redirect manager (bloat review step 2.20).
 */

const lastWritten = new Map<string, number>();
const THROTTLE_MAX = 5_000;

/** Whether this build's database must not be written to: a prerender at build time is not a visitor. */
const building = (): boolean => process.env.NEXT_PHASE === "phase-production-build";

/**
 * Counts one request for a missing address (`path` in the normal form, no query: the caller reads nothing else of the request). Refused addresses are not
 * recorded (`recordablePath()`); a flood of one address is written once a second at most per server instance; any failure is logged and dropped. Never throws.
 * `crawler` is a flag taken from the request by the caller, never stored as text. True when a row was written.
 */
export async function recordNotFound(storeId: string, path: string, crawler = false, now: number = Date.now()): Promise<boolean> {
  try {
    if (building()) return false;
    const normal = normalisePath(path, 200);
    if (normal === null || !recordablePath(normal)) return false;
    const key = `${storeId}|${normal}`;
    const before = lastWritten.get(key);
    if (before !== undefined && now - before < NOT_FOUND_THROTTLE_MS) return false;
    if (lastWritten.size >= THROTTLE_MAX) lastWritten.clear();
    lastWritten.set(key, now);
    await db().execute(sql`select commerce.record_not_found(${storeId}::uuid, ${normal}, ${crawler === true}, ${NOT_FOUND_DAY_CAP})`);
    return true;
  } catch (error) {
    log("error", "not_found.record_failed", {}, error);
    return false;
  }
}

/** Forgets the throttle (tests). */
export const resetNotFoundThrottle = (): void => lastWritten.clear();
