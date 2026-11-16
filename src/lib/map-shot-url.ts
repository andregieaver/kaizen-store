import { breakpointsOf, typicalWidth, TYPICAL_SCREENS, type Breakpoints, type Size } from "./breakpoints";
import { consentCookieName, encodeConsent, NO_CONSENT } from "./cookie-consent";
import { dataCookieName, encodeAssignments, MARKER_COOKIE } from "./experiments";
import type { MapCookie, MapViewport } from "./map-shoot";
import type { HeatDevice } from "./page-heat";

/**
 * Where and how the heatmaps' photographer opens a page (D656, `docs/heatmaps-and-recordings.md` 9.2), pure so it is tested: a page key
 * (`/{market}/…`, as heat totals keep it) back to its market and path, the screen of a device at the store's breakpoints, and the cookies:
 * a consent that refused every optional cookie under the site's own version (the banner stays closed, no tool loads), and for a version of
 * an A/B test other than `a`, the two cookies the proxy reads to serve it. The address is never changed for a version.
 */

/** A robot's visitor id: never a person's. */
export const ROBOT_VISITOR = "00000000-0000-4000-8000-000000000000";

const SIZE_OF: Record<HeatDevice, Size> = { mobile: "sm", tablet: "md", desktop: "xl" };

/** The market and the path under it of a page key; null for a key that is not one. */
export function pageOfKey(page: string): { market: string; path: string } | null {
  const match = /^\/([a-z0-9-]{2,40})(\/.*)?$/.exec(page);
  if (!match) return null;
  return { market: match[1], path: match[2] ?? "" };
}

/** The screen a device is photographed on, at the store's breakpoints. */
export function mapViewport(theme: { breakpoints?: Breakpoints } | null | undefined, device: HeatDevice): MapViewport {
  const size = SIZE_OF[device];
  return { width: typicalWidth(breakpointsOf(theme), size), height: TYPICAL_SCREENS[size].height, mobile: device === "mobile" };
}

/** The cookies a picture is taken with: consent refused under `consentVersion`, and the version's cookies for a tag of b, c or d. */
export function mapCookies(storeId: string, consentVersion: string, tag: string): MapCookie[] {
  const cookies: MapCookie[] = [{ name: consentCookieName(storeId), value: encodeConsent({ visitor: ROBOT_VISITOR, version: consentVersion, choices: NO_CONSENT }) }];
  const version = /^([0-9a-f-]{36}):([a-d])$/.exec(tag);
  if (version && version[2] !== "a") {
    cookies.push(
      { name: MARKER_COOKIE, value: "1" },
      { name: dataCookieName(storeId), value: encodeURIComponent(encodeAssignments({ visitor: ROBOT_VISITOR, versions: { [version[1]]: version[2] } })) },
    );
  }
  return cookies;
}
