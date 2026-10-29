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
    outsideNext(() => revalidateTag(tag, "max"));
  }
}

/**
 * Runs a revalidation, doing nothing where no Next request is running (a script, a test): there is no cache there to refresh, and Next
 * says so by throwing that its static generation store is missing. Anything else it throws (a refresh during render) is thrown on.
 */
function outsideNext(revalidate: () => void): void {
  try {
    revalidate();
  } catch (error) {
    if (error instanceof Error && /static generation store missing/i.test(error.message)) return;
    throw error;
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
    outsideNext(() => revalidateTag(tag, { expire: 0 }));
  }
}
