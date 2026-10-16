import "server-only";

import { LOOK, looking } from "@/lib/replicate-look";
import { shootLook } from "@/lib/theme-shoot";

import { launchBrowser } from "./browser";
import { SHOT_MS, type ShotDeps } from "./theme-shots";

/**
 * The theme shots' photographer (`docs/theme-showcase-phase-2.md` step 1): one browser for one look at one width, closed after, within
 * `SHOT_MS` (D150's rule, `looking()`). The only module of the theme shots that loads Chromium, imported only by the job's route, which is
 * in `outputFileTracingIncludes`.
 */
export const browserPhotographer: ShotDeps["photograph"] = (url, kind) => looking(launchBrowser, SHOT_MS - LOOK.closeMs, (browser) => shootLook(browser, url, kind));
