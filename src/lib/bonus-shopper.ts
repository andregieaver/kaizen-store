import { withoutVat } from "./b2b";
import type { BonusEntry, CartBonus } from "./bonus";
import { minorUnitDigits } from "./money";

/**
 * What a shopper's screens do with the bonus program (D130): which state the credits control is in, what an amount typed
 * in it means, how credits show in the totals of a business buyer and on an order, and what My account lists as still
 * to become usable. Pure, so the browser and the tests use the same rules; the server checks everything again
 * (`setCartCredits()` holds the limits).
 */

/** What the credits control shows: nothing, the invitation to sign in, the control itself, or only notes. */
export type CreditsMode = "off" | "guest" | "use" | "note";

export function creditsMode(bonus: CartBonus): CreditsMode {
  if (!bonus.enabled) return "off";
  if (!bonus.signedIn) return bonus.earnPercent > 0 ? "guest" : "off";
  if (bonus.maxUsableMinor > 0 || bonus.usingMinor > 0) return "use";
  // Nothing to use: still worth saying what is coming, or that credits exist but cannot be used here.
  return bonus.availableMinor > 0 || bonus.pendingMinor > 0 || bonus.willEarnMinor > 0 ? "note" : "off";
}

/** The result of the credits form, for the shopper to read. */
export type CreditsState = { status: "idle" | "done" | "problem"; message: string };

export const CREDITS_IDLE: CreditsState = { status: "idle", message: "" };

/**
 * An amount typed in major units, as minor units: a comma or a point as the decimal mark, spaces ignored, no more
 * decimals than the currency has. Null for anything else.
 */
export function parseCreditsAmount(text: string, currency: string): number | null {
  const digits = minorUnitDigits(currency);
  const cleaned = text.trim().replace(/[\s  ]/g, "");
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(cleaned)) return null;
  const [whole = "", fraction = ""] = cleaned.replace(",", ".").split(".");
  if (/[1-9]/.test(fraction.slice(digits))) return null;
  const minor = Number(whole || "0") * 10 ** digits + Number(fraction.slice(0, digits).padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** An amount of minor units as the input shows it: the number in the locale's own decimal mark, empty for none. */
export function creditsInputValue(minor: number, currency: string, locale: string): string {
  if (minor <= 0) return "";
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

export type CreditsRequest =
  | { ok: true; amountMinor: number; clamped: boolean }
  | { ok: false; reason: "invalid" | "nothing" };

/**
 * What the shopper asked for with the credits form: the amount typed, all available ("Use all available"), or none
 * (the box unticked, or a remove). A ticked box with no amount means all. An amount above what can be used is
 * brought down to it, and the shopper is told.
 */
export function creditsRequest(input: {
  intent: string;
  use: boolean;
  amountText: string;
  maxUsableMinor: number;
  currency: string;
}): CreditsRequest {
  const max = Math.max(0, input.maxUsableMinor);
  if (input.intent === "all")
    return max > 0 ? { ok: true, amountMinor: max, clamped: false } : { ok: false, reason: "nothing" };
  if (input.intent === "remove" || !input.use) return { ok: true, amountMinor: 0, clamped: false };
  if (input.amountText.trim() === "")
    return max > 0 ? { ok: true, amountMinor: max, clamped: false } : { ok: false, reason: "nothing" };
  const typed = parseCreditsAmount(input.amountText, input.currency);
  if (typed === null) return { ok: false, reason: "invalid" };
  if (typed === 0) return { ok: true, amountMinor: 0, clamped: false };
  if (max === 0) return { ok: false, reason: "nothing" };
  return typed > max ? { ok: true, amountMinor: max, clamped: true } : { ok: true, amountMinor: typed, clamped: false };
}

/**
 * Credits shown without VAT, for a business buyer (B2B). Credits come off goods, so their share is spread over the
 * goods by value, each part at its own VAT rate; the parts add up to the same amount however it is split.
 */
export function creditsNet(creditsMinor: number, parts: { minor: number; rate: number }[]): number {
  const weight = parts.reduce((sum, part) => sum + Math.max(0, part.minor), 0);
  if (creditsMinor <= 0 || weight <= 0) return 0;
  const shares = parts.map((part) => Math.floor((creditsMinor * Math.max(0, part.minor)) / weight));
  const left = creditsMinor - shares.reduce((sum, share) => sum + share, 0);
  if (left > 0) {
    const largest = parts.reduce((best, part, i) => (part.minor > (parts[best]?.minor ?? 0) ? i : best), 0);
    shares[largest] = (shares[largest] ?? 0) + left;
  }
  return shares.reduce((sum, share, i) => sum + withoutVat(share, parts[i]?.rate ?? 0), 0);
}

/** Credits on an order, as the order keeps them (amounts in the order's currency). */
export type OrderBonus = { usedMinor: number; earnedMinor: number; availableAt: string | null };

/**
 * "You earned … in bonus credits, usable from …" for an order, or null when it earned none. Credits that are usable
 * already (or have no date) are said to be ready. The caller brings the wording: the page's and the email's own.
 */
export function earnedText(
  bonus: OrderBonus | null | undefined,
  words: {
    money: (minor: number) => string;
    date: (iso: string) => string;
    line: (amount: string, date: string) => string;
    ready: (amount: string) => string;
  },
  now: Date = new Date(),
): string | null {
  if (!bonus || bonus.earnedMinor <= 0) return null;
  const amount = words.money(bonus.earnedMinor);
  const at = bonus.availableAt ? new Date(bonus.availableAt) : null;
  return at && !Number.isNaN(at.getTime()) && at.getTime() > now.getTime()
    ? words.line(amount, words.date(bonus.availableAt as string))
    : words.ready(amount);
}

/**
 * What of a balance's pending credits becomes usable when, as amounts by day: the grants in the history that are not
 * usable yet, soonest first, never more in all than the balance says is pending (a refund may have taken some back).
 */
export function pendingParts(
  entries: BonusEntry[],
  pendingMinor: number,
  now: Date = new Date(),
): { availableAt: string; amountMinor: number }[] {
  const byDay = new Map<string, { availableAt: string; amountMinor: number }>();
  for (const entry of entries) {
    if (entry.kind !== "earn" || !entry.availableAt || entry.amountMinor <= 0) continue;
    if (new Date(entry.availableAt).getTime() <= now.getTime()) continue;
    const day = entry.availableAt.slice(0, 10);
    const part = byDay.get(day);
    if (part) part.amountMinor += entry.amountMinor;
    else byDay.set(day, { availableAt: entry.availableAt, amountMinor: entry.amountMinor });
  }
  const parts = [...byDay.values()].sort((a, b) => a.availableAt.localeCompare(b.availableAt));
  let excess = parts.reduce((sum, part) => sum + part.amountMinor, 0) - Math.max(0, pendingMinor);
  for (let i = parts.length - 1; i >= 0 && excess > 0; i--) {
    const cut = Math.min(excess, parts[i].amountMinor);
    parts[i].amountMinor -= cut;
    excess -= cut;
  }
  return parts.filter((part) => part.amountMinor > 0);
}

/** A percentage back as the shopper reads it: 5, 2.5 (in the locale's decimal mark). */
export function earnPercentText(earnPercent: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(earnPercent);
}
