
/**
 * Cookie consent (D58), for Kaizen's own site and each store: the optional
 * tools an owner can switch on, the categories of cookies, what each known
 * cookie is for, and the consent cookie that remembers a visitor's choice.
 * Shared by the storefront, the consent widget in the browser and the admin.
 */

/** Cookie categories; only the optional ones are asked about. */
export const CONSENT_CATEGORIES = ["necessary", "preferences", "statistics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export const OPTIONAL_CATEGORIES = ["preferences", "statistics", "marketing"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];
export type ConsentChoices = Record<OptionalCategory, boolean>;

export const NO_CONSENT: ConsentChoices = { preferences: false, statistics: false, marketing: false };
export const FULL_CONSENT: ConsentChoices = { preferences: true, statistics: true, marketing: true };

// ---------------------------------------------------------------------------
// Tools an owner switches on
// ---------------------------------------------------------------------------

/** Analytics and marketing tools, by the id each service gives; none is loaded without consent. */
export type TrackingSettings = {
  ga4?: string;
  gtm?: string;
  metaPixel?: string;
  /** Google Ads' tag (`AW-…`, D303 I1): remarketing and the shop events; purchases are measured through GA4 linking. */
  googleAds?: string;
  tiktokPixel?: string;
  pinterestTag?: string;
};

/** The ads tags only a store may switch on (D303 I1); Kaizena Flow's own site keeps GA4, Tag Manager and the Meta Pixel. */
export const STORE_ONLY_TOOLS = ["googleAds", "tiktokPixel", "pinterestTag"] as const;

/** The categories a set of tools needs consent for: Analytics is statistics; the Pixel marketing; Tag Manager may run either. */
export function toolCategories(tracking: TrackingSettings): OptionalCategory[] {
  const used = new Set<OptionalCategory>();
  if (tracking.ga4) used.add("statistics");
  if (tracking.gtm) {
    used.add("statistics");
    used.add("marketing");
  }
  if (tracking.metaPixel || tracking.googleAds || tracking.tiktokPixel || tracking.pinterestTag) used.add("marketing");
  return OPTIONAL_CATEGORIES.filter((c) => used.has(c));
}

// ---------------------------------------------------------------------------
// The consent cookie
// ---------------------------------------------------------------------------

/** How long a choice lasts before a visitor is asked again, as Datatilsynet recommends at most. */
export const CONSENT_DAYS = 365;

/** Sent on `window` when the visitor has just made a choice, for what waits on it (Kaizen's referral cookie, D131). */
export const CONSENT_CHANGED_EVENT = "kaizen:consent-changed";

/** The consent cookie of Kaizen's site (null) or a store's, one per site so choices are the site's own. */
export const consentCookieName = (storeId: string | null) => `consent_${storeId ?? "kaizen"}`;

/**
 * Which optional categories a site asks about. A choice made against another
 * list is asked again, so a visitor who allowed statistics is asked before
 * marketing starts.
 */
export const consentVersion = (categories: readonly OptionalCategory[]) =>
  OPTIONAL_CATEGORIES.filter((c) => categories.includes(c)).join("+");

export type StoredConsent = { visitor: string; version: string; choices: ConsentChoices };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `1.{visitor}.{version}.{p}{s}{m}`: readable in the browser, which applies it before anything loads. */
export function encodeConsent({ visitor, version, choices }: StoredConsent): string {
  const bits = OPTIONAL_CATEGORIES.map((c) => (choices[c] ? "1" : "0")).join("");
  return `1.${visitor}.${version || "none"}.${bits}`;
}

export function decodeConsent(value: string | undefined | null): StoredConsent | null {
  const match = /^1\.([0-9a-f-]{36})\.([a-z+]{1,60})\.([01]{3})$/.exec(value ?? "");
  if (!match || !UUID.test(match[1])) return null;
  const [p, s, m] = match[3].split("").map((bit) => bit === "1");
  return {
    visitor: match[1],
    version: match[2] === "none" ? "" : match[2],
    choices: { preferences: p, statistics: s, marketing: m },
  };
}

/** A choice still stands when it was made against the categories the site asks about now. */
export const consentIsCurrent = (stored: StoredConsent | null, version: string) =>
  stored !== null && stored.version === version;

/**
 * Whether the visitor allowed preferences on this site (D58): read from the
 * consent cookie. A remembered closing is a preference, so nothing is kept
 * without it.
 */
export function mayRemember(cookies: string, storeId: string | null): boolean {
  const name = consentCookieName(storeId);
  const pair = cookies.split("; ").find((cookie) => cookie.startsWith(`${name}=`));
  return decodeConsent(pair?.slice(name.length + 1))?.choices.preferences === true;
}
