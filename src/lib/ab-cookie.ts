/**
 * A/B tests' cookies (D148): the version keys, the cookies' names and what they hold. Apart from `experiments.ts`, which re-exports them,
 * because the visitor's scripts read them (`AbAssign`, `AbMarker`, on every store page): that module, with every goal's words and a test's
 * checks, is the server's and the admin's, and was in every store page's first scripts while they imported it. Pure.
 */

export const VARIANT_KEYS = ["a", "b", "c", "d"] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

/**
 * `kaizen_ab=1` says "this browser has assignments"; the proxy's matcher can only look for one cookie name, so it is
 * the one it looks for. It holds nothing. The assignments are in `kaizen_ab_{storeId}`, one per store, so a visitor's
 * id is never the same at two stores.
 */
export const MARKER_COOKIE = "kaizen_ab";
export const dataCookieName = (storeId: string) => `kaizen_ab_${storeId}`;
export const COOKIE_DAYS = 90;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** A visitor's answer for a test they are not in (the traffic share, the audience): they see the original and are never counted. */
export const OUTSIDE = "0";
const isVersion = (value: unknown): value is string => value === OUTSIDE || (VARIANT_KEYS as readonly string[]).includes(value as string);

export type Assignments = { visitor: string; versions: Record<string, string> };

/** `1.{visitor}.{experiment}={variant},…`: the browser's own random id for this store, and the version it has for each test. */
export function encodeAssignments({ visitor, versions }: Assignments): string {
  const pairs = Object.entries(versions)
    .filter(([id, variant]) => isUuid(id) && isVersion(variant))
    .slice(0, 12)
    .map(([id, variant]) => `${id}=${variant}`)
    .join(",");
  return `1.${visitor}.${pairs}`;
}

export function decodeAssignments(value: string | undefined | null): Assignments | null {
  const match = /^1\.([0-9a-f-]{36})\.([0-9a-z=,-]{0,600})$/.exec(value ?? "");
  if (!match || !isUuid(match[1])) return null;
  const versions: Record<string, string> = {};
  for (const pair of match[2].split(",")) {
    const [id, variant] = pair.split("=");
    if (isUuid(id) && isVersion(variant)) versions[id] = variant;
  }
  return { visitor: match[1], versions };
}

