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
