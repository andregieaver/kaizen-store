/**
 * A preview link to share (D148 phase 20, `docs/ab-testing.md`): a signed link that shows one version of a running A/B test on the live site to
 * whoever opens it, never counted, never indexed, and over when the test stops. The link (`/api/ab/preview?t={token}`) sets the cookie
 * `kaizen_ab_preview` to the token, with the marker `kaizen_ab` so the proxy looks at the request; the proxy serves the named version for that
 * test (`withPreview()`), and while a browser holds a good preview of a store the server reads no assignment for it, so it records nothing.
 *
 * This part is browser-safe: the cookie's name and what a token says, unchecked (the browser only uses it to keep quiet). Signing and checking are
 * `src/lib/ab-preview-sign.ts`.
 */

import { decodeAssignments, encodeAssignments } from "./experiments";

export const PREVIEW_COOKIE = "kaizen_ab_preview";
/** A link is good for this long, while its test runs; the cookie it sets for a day. */
export const PREVIEW_LINK_DAYS = 30;
export const PREVIEW_COOKIE_SECONDS = 24 * 60 * 60;

export type Preview = { storeId: string; experiment: string; version: string; expires: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^[b-d]$/;

const fromBase64Url = (text: string): string | null => {
  try {
    const plain = text.replace(/-/g, "+").replace(/_/g, "/");
    return typeof atob === "function" ? atob(plain) : Buffer.from(plain, "base64").toString("utf8");
  } catch {
    return null;
  }
};

/** What a token's body says, unchecked; null for anything that is not one. */
export function previewBody(token: string | undefined | null): Preview | null {
  if (!token || token.length > 400) return null;
  const [body] = token.split(".");
  const json = body ? fromBase64Url(body) : null;
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed[0] !== 1) return null;
    const [, storeId, experiment, version, expires] = parsed as [number, unknown, unknown, unknown, unknown];
    if (typeof storeId !== "string" || !UUID.test(storeId) || typeof experiment !== "string" || !UUID.test(experiment)) return null;
    if (typeof version !== "string" || !VERSION.test(version) || typeof expires !== "number") return null;
    return { storeId, experiment, version, expires };
  } catch {
    return null;
  }
}

/**
 * The cookie's value: the test's id, then the signed token (`{experiment}:{token}`), so the browser can tell which test it previews without decoding
 * anything (a page's first scripts stay as small as they were). Only the token is trusted, and only once checked (`readPreview()`).
 */
export const previewCookieValue = (experiment: string, token: string): string => `${experiment}:${token}`;

/** The token in a preview cookie's value, or null. */
export const tokenOfCookie = (value: string | undefined | null): string | null => {
  const at = value ? value.indexOf(":") : -1;
  return value && at > 0 ? value.slice(at + 1) : null;
};

/** The test a browser is previewing, from its own cookie, for the browser to keep quiet about it; null when it previews none. Unchecked. */
export function previewedTest(read: (name: string) => string | undefined): string | null {
  const value = read(PREVIEW_COOKIE);
  const at = value ? value.indexOf(":") : -1;
  return value && at > 0 ? value.slice(0, at) : null;
}

/** A visitor id for a browser that has none, so a preview can be written in the assignment cookie's shape for `variantPath()`; never stored. */
const NO_VISITOR = "00000000-0000-4000-8000-000000000000";

/**
 * The assignment cookie's value as the proxy should read it while a browser previews a version (D148 phase 20): its own versions, with the
 * previewed test's set to the version the link names. Only the proxy reads it; nothing is written back to the browser.
 */
export function withPreview(dataCookie: string | undefined, preview: Pick<Preview, "experiment" | "version">): string {
  const mine = decodeAssignments(dataCookie);
  return encodeAssignments({ visitor: mine?.visitor ?? NO_VISITOR, versions: { ...(mine?.versions ?? {}), [preview.experiment]: preview.version } });
}
