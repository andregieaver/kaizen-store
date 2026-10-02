/**
 * What the visit beacon sends and when (D152, docs/analytics.md, "Visit counting"). Pure, so it is tested without a
 * browser; `VisitBeacon` only wires it to `navigator`, `location` and `sendBeacon`.
 *
 * It uses no cookie and no storage of any kind (a test reads this file and the component to hold it to that). What is
 * sent is the path of the page (never its query), the referring site's host when it is another site, the three `utm_*`
 * tags and whether an ad click id was in the address (never its value), and only on the first page view of a page load.
 */

/** The endpoint, same-site. */
export const VISIT_ENDPOINT = "/api/visit";

/** Longest body the server takes. The beacon stays well under it. */
export const MAX_BODY_BYTES = 1000;
/** Kept shorter than that, so the largest body is about 700 bytes and a multi-byte character cannot tip it over. */
const SOFT_BODY_BYTES = 900;

export const LIMITS = { path: 300, referrer: 120, source: 60, medium: 30, campaign: 80 } as const;

/** Two page views of one path closer together than this are one (a double fire, a strict-mode remount). */
export const DEBOUNCE_MS = 1500;

export type VisitBody = {
  store: string;
  path: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  gclid?: true;
  fbclid?: true;
  ttclid?: true;
};

/** What the browser says about being tracked. Any of them being on means nothing is sent. */
export type PrivacySignals = {
  globalPrivacyControl?: boolean | null;
  doNotTrack?: string | null;
  windowDoNotTrack?: string | null;
  msDoNotTrack?: string | null;
};

/** Global Privacy Control, or Do Not Track under any of the names browsers have given it. */
export function optedOut(signals: PrivacySignals): boolean {
  if (signals.globalPrivacyControl === true) return true;
  return [signals.doNotTrack, signals.windowDoNotTrack, signals.msDoNotTrack].some((value) => value === "1" || value === "yes");
}

/** The host of the referring page when it is another site than this one; empty for none, for ourselves or for junk. */
export function referrerHost(referrer: string | null | undefined, ownHost: string): string {
  if (!referrer) return "";
  let host: string;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return referrer.startsWith("android-app://") ? androidApp(url) : "";
    host = url.host.toLowerCase();
  } catch {
    return "";
  }
  const own = ownHost.toLowerCase();
  return host === own || host.length > LIMITS.referrer ? "" : host;
}

/** An Android app's referrer (`android-app://com.google.android.gm`) is its package name, which the classifier knows. */
function androidApp(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.length > 0 && host.length <= LIMITS.referrer ? host : "";
}

const clip = (value: string | null, max: number): string | undefined => {
  if (!value) return undefined;
  const text = value.trim().slice(0, max);
  return text === "" ? undefined : text;
};

/** The tags and click-id flags of an address's query string. */
export function campaignParams(search: string): Pick<VisitBody, "utm_source" | "utm_medium" | "utm_campaign" | "gclid" | "fbclid" | "ttclid"> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }
  const out: ReturnType<typeof campaignParams> = {};
  const source = clip(params.get("utm_source"), LIMITS.source);
  const medium = clip(params.get("utm_medium"), LIMITS.medium);
  const campaign = clip(params.get("utm_campaign"), LIMITS.campaign);
  if (source) out.utm_source = source;
  if (medium) out.utm_medium = medium;
  if (campaign) out.utm_campaign = campaign;
  // Only that an ad click id was there: its value identifies a click, and is never sent.
  for (const id of ["gclid", "fbclid", "ttclid"] as const) if (params.has(id)) out[id] = true;
  return out;
}

const bytes = (text: string): number => new TextEncoder().encode(text).length;

export type BeaconInput = {
  store: string;
  /** `location.pathname`: the path as the browser has it, without the query. */
  path: string;
  /** `location.search`. */
  search: string;
  referrer: string | null | undefined;
  /** `location.host`. */
  ownHost: string;
  /** First page view of this page load: only then the referrer and the tags mean something. */
  first: boolean;
};

/**
 * The body for a page view, as JSON text, or null when there is nothing worth sending (no path). Beyond the first page view
 * of a load only the path goes. If the whole would be larger than the beacon allows itself, the tags are dropped first.
 */
export function beaconBody(input: BeaconInput): string | null {
  const path = input.path.split(/[?#]/, 1)[0].slice(0, LIMITS.path);
  if (!path.startsWith("/") || !input.store) return null;
  const body: VisitBody = { store: input.store, path };
  if (input.first) {
    const host = referrerHost(input.referrer, input.ownHost);
    if (host) body.referrer = host;
    Object.assign(body, campaignParams(input.search));
  }
  let text = JSON.stringify(body);
  for (const drop of ["utm_campaign", "utm_source", "utm_medium", "referrer"] as const) {
    if (bytes(text) <= SOFT_BODY_BYTES) break;
    delete body[drop];
    text = JSON.stringify(body);
  }
  return bytes(text) <= MAX_BODY_BYTES ? text : null;
}

/** Remembers the last page view sent, to leave out a second one of the same path within `DEBOUNCE_MS`. */
export type Debounce = { path: string; at: number } | null;

export function shouldSend(last: Debounce, path: string, now: number): boolean {
  return !(last && last.path === path && now - last.at >= 0 && now - last.at < DEBOUNCE_MS);
}
