import "server-only";

import { decodeAssignments, OUTSIDE, dataCookieName } from "@/lib/experiments";
import { tagOf } from "@/lib/page-heat";

import { runningExperiments } from "./experiments-running";

/**
 * The cookies a beacon brought, and the A/B versions it may be tagged with (D656, `docs/heatmaps-and-recordings.md` 8.4). The browser says
 * which versions it was shown; only those its own A/B cookie holds for a running test are kept. The A/B visitor id is never returned:
 * it leads to the visitor's carts and orders, and heat totals keep no one.
 */

/** A cookie's value from a request's Cookie header, URI-decoded (Next writes the A/B cookie encoded); undefined when absent. */
export function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    const raw = part.slice(at + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** The claimed versions this visitor's cookie confirms for a running test, as distinct sorted tags (`{experiment}:{version}`). */
export async function verifiedTags(storeId: string, claimed: readonly (readonly [string, string])[], cookieHeader: string | null): Promise<string[]> {
  if (claimed.length === 0) return [];
  const mine = decodeAssignments(cookieValue(cookieHeader, dataCookieName(storeId)))?.versions;
  if (!mine) return [];
  const running = new Set((await runningExperiments(storeId)).map((test) => test.id));
  const tags = claimed.filter(([experiment, version]) => version !== OUTSIDE && mine[experiment] === version && running.has(experiment)).map(([e, v]) => tagOf(e, v));
  return [...new Set(tags)].sort();
}
