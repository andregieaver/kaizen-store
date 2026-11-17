import { shownVersions } from "./ab-shown";
import { OWN_SPEED_ENDPOINT, SPEED_ENDPOINT, speedBody, type OwnSpeedSite, type SpeedMetric } from "./speed";

/**
 * What the speed beacon sends when the page is hidden, and where: a store's page tagged with the A/B versions it showed (D148 phase 19),
 * Kaizena Flow's own site and the admin to their own endpoint (D390). `SpeedBeacon` loads this with web-vitals once the page has started,
 * so it is not in a store page's first scripts (`e2e/performance.spec.ts`); the figures cannot be read before web-vitals is there anyway.
 */
export function speedRequest(input: {
  store?: string;
  own?: OwnSpeedSite;
  path: string;
  width: number;
  values: Partial<Record<SpeedMetric, number>>;
}): { url: string; body: string } | null {
  const { own, path, width, values } = input;
  const body = speedBody({ store: own ?? input.store ?? "", path, width, values, ab: own ? [] : shownVersions() });
  return body ? { url: own ? OWN_SPEED_ENDPOINT : SPEED_ENDPOINT, body } : null;
}
