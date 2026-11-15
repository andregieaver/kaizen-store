/**
 * Ready offers on the Coupons page (round 9, D630): four codes most shops make, each opening New coupon filled in so Homer only presses
 * Save. Pure: the form turns an offer into its draft with the store's markets.
 */
export const OFFER_KEYS = ["welcome", "free_shipping", "newsletter", "thanks"] as const;
export type OfferKey = (typeof OFFER_KEYS)[number];

export type OfferShape = {
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  percent?: number;
  /** Money off and the least basket, in major units of the store's main currency (markets in other currencies are left empty). */
  amountMajor?: number;
  minSubtotalMajor?: number;
  oncePerCustomer?: boolean;
  /** Ends this many days after it is made. */
  endsInDays?: number;
};

export const OFFERS: Record<OfferKey, OfferShape> = {
  welcome: { code: "WELCOME10", kind: "percent", percent: 10, oncePerCustomer: true },
  free_shipping: { code: "FRAKTFRI", kind: "free_shipping" },
  newsletter: { code: "NEWS15", kind: "percent", percent: 15, endsInDays: 14 },
  thanks: { code: "TAKK100", kind: "fixed", amountMajor: 100, minSubtotalMajor: 500, oncePerCustomer: true },
};

export function isOfferKey(value: unknown): value is OfferKey {
  return typeof value === "string" && (OFFER_KEYS as readonly string[]).includes(value);
}

/** `datetime-local` text `days` after `now`, in Norwegian time, at 23:59. */
export function endsAtLocal(days: number, now = new Date()): string {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(now.getTime() + days * 86_400_000),
  );
  return `${day}T23:59`;
}
