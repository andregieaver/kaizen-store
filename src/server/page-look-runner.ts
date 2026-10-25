import "server-only";

import { LOOK, looking } from "@/lib/replicate-look";
import { shootPage } from "@/lib/page-look-shoot";

import { launchBrowser } from "./browser";
import type { LookDeps } from "./page-looks";

/** One width of a look within this long, Chromium's start included. */
export const LOOK_SHOT_MS = 60_000;

/**
 * The page looks' photographer (D310, `docs/ai-autopilot.md` 9.2): one browser for one width, closed after, within `LOOK_SHOT_MS` (D150's
 * rule, `looking()`). The only module of the looks that loads Chromium, imported only by the looks' route, which is in
 * `outputFileTracingIncludes`.
 */
export const browserLookPhotographer: NonNullable<LookDeps["photograph"]> = (url, width) =>
  looking(launchBrowser, LOOK_SHOT_MS - LOOK.closeMs, (browser) => shootPage(browser, url, width));
