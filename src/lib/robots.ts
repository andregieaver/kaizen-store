/**
 * Whether a site's robots.txt lets Kaizena Flow's research read a page (D900 M2, `docs/market-check.md` 4; RFC 9309). Pure: the server
 * fetches the file (`readWebPage()` in `src/server/research.ts`), this decides. The rules are the chat crawler's (`robotsRules()` and
 * `robotsAllow()`, D583: the group naming `KaizenaFlowBot`, else `*`; the longest rule wins, Allow a tie). What differs is an answer that
 * is not a file: a missing robots.txt (4xx) allows everything, while a server error or an unreachable site allows nothing, since the site
 * may be saying no and cannot be heard (RFC 9309 2.3.1.3 and 2.3.1.4). The crawler reads a site its owner gave it; research reads others'.
 */

import { robotsAllow, robotsRules } from "./site-crawl";

/** The bytes of a robots.txt read, at most: RFC 9309 asks a reader to take at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 512 * 1024;

/** A robots.txt as fetched: the status and text of an answer, or a fetch that failed before any. */
export type RobotsAnswer = { status: number; text: string } | { failed: true };

export function robotsVerdict(answer: RobotsAnswer, pathAndQuery: string): "allowed" | "refused" | "unknown" {
  if ("failed" in answer) return "unknown";
  if (answer.status >= 200 && answer.status < 300) return robotsAllow(robotsRules(answer.text), pathAndQuery || "/") ? "allowed" : "refused";
  if (answer.status >= 400 && answer.status < 500) return "allowed";
  return "unknown";
}
