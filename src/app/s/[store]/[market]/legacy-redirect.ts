import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { catalogTag } from "@/server/catalog";
import { redirectsTag } from "@/lib/redirects";
import { recordNotFound } from "@/server/not-found";
import { legacyAnswerOf } from "@/server/redirect-resolve";
import { getOpenStore } from "@/server/stores";

/**
 * Where an address whose first part only LOOKS like a market goes (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.1.3, 5.3): `/s/demo/om-oss` is no
 * market of the store, so the market layout would give a 404, and the proxy's matcher leaves such a path alone (a first part of two letters is a market's
 * to serve). A manual redirect from `/om-oss` goes, for good, to its target in the store's main market; anything else is the 404 it was, counted for the 404 report.
 *
 * It is a cached lookup for the reason `missOrRedirect()`'s is (a lookup that reads the database per request makes the response a streamed 200: the status of a
 * 308 or a 404 is only given by a cached one), tagged `redirectsTag(store)` so a redirect added after a first 404 takes effect at once. Only the first part of
 * the address is known to a layout, so a path of several parts that begins with a market-looking one (`/om-oss/team`) is the 404 it was.
 */
export async function legacyLocation(storeSlug: string, first: string): Promise<string | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1, expire: 3600 });
  const store = await getOpenStore(storeSlug);
  if (!store) return null;
  cacheTag(redirectsTag(store.id), catalogTag(store.id));
  try {
    const answer = await legacyAnswerOf(storeSlug, `/${first}`, "");
    if (answer && "location" in answer) return answer.location;
    if (answer && "miss" in answer) await recordNotFound(answer.miss.storeId, answer.miss.path, false);
  } catch (error) {
    console.error("[redirects] a lookup of an address that looks like a market failed:", error instanceof Error ? error.message : error);
  }
  return null;
}
