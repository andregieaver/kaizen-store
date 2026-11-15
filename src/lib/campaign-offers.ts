/**
 * Ready sales on the Campaigns page (round 10, D633): four campaigns most shops run, each opening New campaign filled in so Homer
 * chooses what is left (a category, a gift) and presses Save. Pure: the form turns a sale into its draft with the store's markets.
 */
export const SALE_KEYS = ["three_for_two", "weekend", "free_shipping", "gift"] as const;
export type SaleKey = (typeof SALE_KEYS)[number];

export type SaleShape = {
  kind: "percent" | "multi_buy" | "free_shipping" | "gift";
  percent?: number;
  /** The basket it needs, in major units of the store's main currency (markets in other currencies are left empty). */
  thresholdMajor?: number;
  /** Some products, a category or a tag, chosen by the owner. */
  some?: boolean;
  /** From next Friday 00:00 to Sunday 23:59, Norwegian time. */
  weekend?: boolean;
};

export const SALES: Record<SaleKey, SaleShape> = {
  three_for_two: { kind: "multi_buy", some: true },
  weekend: { kind: "percent", percent: 20, weekend: true },
  free_shipping: { kind: "free_shipping", thresholdMajor: 800 },
  gift: { kind: "gift", thresholdMajor: 1000 },
};

export function isSaleKey(value: unknown): value is SaleKey {
  return typeof value === "string" && (SALE_KEYS as readonly string[]).includes(value);
}

/** The coming weekend as `datetime-local` texts: next Friday (today if it is Friday) 00:00 to the Sunday after, 23:59, Oslo time. */
export function nextWeekend(now = new Date()): { startsAt: string; endsAt: string } {
  const osloDay = (d: Date) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const weekday = new Date(`${osloDay(now)}T12:00:00Z`).getUTCDay();
  // Saturday and Sunday are already the weekend: the next one starts in six or five days.
  const toFriday = (5 - weekday + 7) % 7;
  const friday = new Date(now.getTime() + toFriday * 86_400_000);
  const sunday = new Date(friday.getTime() + 2 * 86_400_000);
  return { startsAt: `${osloDay(friday)}T00:00`, endsAt: `${osloDay(sunday)}T23:59` };
}
