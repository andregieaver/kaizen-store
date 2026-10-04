import type { ErasurePlan } from "./erasure-plan";
import { formatMoney } from "./money";
import { formatPrivacyDay, privacyLanguage } from "./privacy-text";

/** What the delete page tells a shopper (see `DeletePlanView`): their own counts and dates, written for them. */
export type DeleteFacts = {
  keptOrders: number;
  /** The day the last kept order's name, address and email go, written for the reader. */
  keptUntil: string | null;
  subscriptions: number;
  cards: number;
  /** The credits that are lost, written (`€10.00`), or null. */
  bonus: string | null;
  optOutKept: boolean;
};

/**
 * Reads the erasure plan (`planErasure()`, the same rules the run uses) as the shopper's page needs it. The kept date is the *last* day
 * any kept order's details go, so the page never says data goes sooner than it does. Credits are shown in the amount the shopper sees
 * in My account (`shownBonus`, in the market's currency); the plan's own figure, in the store's credit currency, is only the fallback.
 */
export function deleteFactsOf(
  plan: ErasurePlan,
  locale: string,
  shownBonus: { currency: string; amountMinor: number } | null,
): DeleteFacts {
  const lang = privacyLanguage(locale);
  const kept = plan.rows.filter((row) => row.table === "orders" && row.action === "restricted");
  const keptOrders = kept.reduce((sum, row) => sum + row.count, 0);
  const days = kept.map((row) => row.keptUntil?.last).filter((day): day is string => Boolean(day)).sort();
  const lost = shownBonus && shownBonus.amountMinor > 0 ? shownBonus : (plan.alsoHappens.bonusForfeited[0] ?? null);
  return {
    keptOrders,
    keptUntil: days.length > 0 ? formatPrivacyDay(days[days.length - 1], lang) : null,
    subscriptions: plan.alsoHappens.subscriptionsCancelled,
    cards: plan.alsoHappens.savedCardsDetached,
    bonus: plan.alsoHappens.bonusForfeited.length === 0 || !lost ? null : formatMoney(lost.amountMinor, lost.currency, locale),
    optOutKept: plan.alsoHappens.emailOptOutKept,
  };
}
