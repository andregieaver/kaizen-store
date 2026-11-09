import type { Conversion, PlatformAdEvent } from "./ad-payloads";
import { cleanAdSignals, type AdSignals } from "./ad-signals";
import { decodeConsent } from "./cookie-consent";
import { majorAmount } from "./shop-events";

/**
 * Kaizena Flow's own conversions (C2, D523): a sign-up and the first paid plan of the store it made, sent to the ad platforms connected to
 * Kaizena Flow's store as a store's checkout and purchase are (D303). The pure parts: whether a sign-up may send at all (the visitor allowed
 * marketing cookies on Kaizena Flow's site, asked with marketing among the choices), the ad platforms' ids their browser held, and each event's
 * facts. Nothing here reads the database; a raw email never leaves, only a SHA-256 hash made by the sender, and only at the *Enhanced* level.
 */

/** A choice that allowed marketing, made when the site asked about marketing; anything else (none, refused, an older list) is no. */
export function allowsMarketing(consentCookie: string | undefined | null): boolean {
  const stored = decodeConsent(consentCookie);
  return stored !== null && stored.choices.marketing && stored.version.split("+").includes("marketing");
}

/** Google's click id from its `_gcl_aw` cookie (`GCL.<seconds>.<click id>`), or nothing. */
export function gclidOf(cookie: string | undefined | null): string | undefined {
  const match = /^GCL\.\d{9,12}\.(.+)$/.exec(cookie ?? "");
  return match ? match[1] : undefined;
}

/**
 * The ids a sign-up keeps, from the cookies Kaizena Flow's site has (the ad platforms' own first-party cookies, set only after marketing
 * consent): null without consent, so nothing is kept and nothing is ever sent for this sign-up.
 */
export function signupAdSignals(cookie: (name: string) => string | undefined, consentCookie: string | undefined | null): AdSignals | null {
  if (!allowsMarketing(consentCookie)) return null;
  return cleanAdSignals({
    fbp: cookie("_fbp"),
    fbc: cookie("_fbc"),
    gclid: gclidOf(cookie("_gcl_aw")),
    ttp: cookie("_ttp"),
    epik: cookie("_epik"),
  });
}

export type PlatformConversionFacts = {
  event: PlatformAdEvent;
  requestId: string;
  /** The plan's sale (`platform_sales.id`) for `plan_paid`: its own event id, so a second plan is never the same event. */
  saleId?: string | null;
  /** When it happened: the request's making, or the sale's payment. */
  at: Date;
  /** A plan: what Kaizena Flow was paid for it, net of VAT, in minor units; a sign-up has none. */
  netMinor?: number;
  currency?: string;
  /** The plan's key, as the line's id. */
  plan?: string | null;
  signals: AdSignals;
  /** SHA-256 of the normalised email, only at the *Enhanced* level. */
  emailHash?: string | null;
  /** Kaizena Flow's site, without a trailing slash. */
  site: string;
};

/** The facts as a conversion: one person's events share GA4's client id (the request's id), each event its own event id. */
export function platformConversion(f: PlatformConversionFacts): Conversion {
  const currency = f.currency ?? "NOK";
  const value = f.event === "plan_paid" ? majorAmount(f.netMinor ?? 0, currency) : 0;
  return {
    event: f.event,
    eventId: f.event === "plan_paid" ? (f.saleId ?? `${f.requestId}:plan`) : f.requestId,
    clientId: f.requestId,
    time: Math.floor(f.at.getTime() / 1000),
    currency,
    value,
    lines: f.event === "plan_paid" ? [{ id: f.plan || "plan", quantity: 1, price: value }] : [],
    signals: f.signals,
    pageUrl: f.event === "sign_up" ? `${f.site}/sign-up` : `${f.site}/admin`,
    ...(f.emailHash ? { hashes: { email: f.emailHash } } : {}),
  };
}
