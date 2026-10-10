import "server-only";

import { revalidateTag, updateTag } from "next/cache";

/**
 * Refreshes a cache tag after a change. A server action may `updateTag` (the person sees it at once); anywhere else (the daily
 * job, a route handler, the AI manager's route) that throws, and the tag is revalidated instead, so a change made outside an
 * action still reaches the pages that draw it.
 */
export function refreshTag(tag: string): void {
  try {
    updateTag(tag);
  } catch {
    revalidateTag(tag, "max");
  }
}

/**
 * The same, for a change whose maker looks at the result at once (changing a page's words where they stand on the site, D192): the tag
 * expires on the spot, so the next request builds the page again and is not served the old one meanwhile (`refreshTag()` marks it
 * stale and serves it while it is made again, which shows the person the words they just replaced). That one request is slower.
 */
export function refreshTagNow(tag: string): void {
  try {
    updateTag(tag);
  } catch {
    revalidateTag(tag, { expire: 0 });
  }
}
