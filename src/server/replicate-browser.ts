import "server-only";

import type { Browser } from "playwright-core";

import { parseReplicaUrl } from "@/lib/replicate-url";
import { openCopy as openCopyPage, openOriginal as openOriginalPage, type Allow, type Opened } from "@/lib/replicate-open";
import type { ViewportName } from "@/lib/replicate-capture";

import { allowPrivate, hostProblem } from "./replicate-fetch";

export type { Opened };

/**
 * The page replicator's browser (D150) as the server uses it: the original is opened with every request to a private address
 * refused (names are looked up once each, and a name with any private address is refused whole); the copy, which is this
 * site's own page, with none.
 */
function allowed(): Allow {
  const checked = new Map<string, Promise<string | null>>();
  return async (url) => {
    const parsed = parseReplicaUrl(url, { allowPrivate: allowPrivate() });
    if (!parsed.ok) return false;
    const host = parsed.url.hostname.replace(/^\[|\]$/g, "");
    let verdict = checked.get(host);
    if (!verdict) {
      verdict = hostProblem(host);
      checked.set(host, verdict);
    }
    return (await verdict) === null;
  };
}

export const openOriginal = (browser: Browser, url: string, viewport: ViewportName, signal?: AbortSignal): Promise<Opened> => openOriginalPage(browser, url, viewport, allowed(), signal);
export const openCopy = openCopyPage;
