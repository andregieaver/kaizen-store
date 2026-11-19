import type { PlanInterval } from "./plans";

/**
 * Moving an account from store-by-store billing to one plan (D748 step E4 part four, `docs/extensions.md` 13), pure: which store's
 * subscription the account keeps, and what the account pays a month before and after. The move itself is `src/server/account-move.ts`.
 */

/** A plan's price a month: a yearly price divided by twelve, rounded. */
export const monthlyMinor = (price: { interval: PlanInterval; amountMinor: number }): number =>
  price.interval === "year" ? Math.round(price.amountMinor / 12) : price.amountMinor;

/** One store of an account as the move weighs it: its plan's position and price a month while its subscription runs. */
export type MoveLine = { storeId: string; createdAt: string; running: boolean; planPosition: number | null; monthly: number | null };

/**
 * The store whose subscription becomes the account's (the owner's answer: "the account gets the highest plan any of them had"): the
 * running one whose plan stands highest (its position on the plans page), then the dearest a month (Plus and Advanced share a position),
 * then the oldest store. None when no store's subscription runs: the account then starts without a plan.
 */
export function keptStore(lines: readonly MoveLine[]): string | null {
  const running = lines.filter((line) => line.running);
  if (running.length === 0) return null;
  const ranked = [...running].sort(
    (a, b) =>
      (b.planPosition ?? -1) - (a.planPosition ?? -1) || (b.monthly ?? 0) - (a.monthly ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.storeId.localeCompare(b.storeId),
  );
  return ranked[0].storeId;
}

/** What running subscriptions cost a month, per currency. */
export function monthlyTotals(prices: readonly { currency: string; interval: PlanInterval; amountMinor: number }[]): { currency: string; minor: number }[] {
  const totals = new Map<string, number>();
  for (const price of prices) totals.set(price.currency, (totals.get(price.currency) ?? 0) + monthlyMinor(price));
  return [...totals].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => a.currency.localeCompare(b.currency));
}
